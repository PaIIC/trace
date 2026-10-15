import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { IdeaRepository } from "../lib/ideas-repository.ts";
import {
  ideaInputSchema,
  parseAnalysis,
  isAnalysisRunning,
  ANALYSIS_LEASE_MS,
} from "../lib/domain.ts";
import { analyzeIdea, getAIConfig } from "../lib/ai.ts";
import {
  ConnectionService,
  connectionInputSchema,
  testDeepSeekConnection,
} from "../lib/ai-connections.ts";
import { ensureLocalEncryptionKey } from "../scripts/local-secrets.mjs";

const analysis = {
  title: "探索一个研究问题",
  summary: "初步概述，仍需验证。",
  question: "改变条件是否影响结果？",
  value: "验证一个可检验的假设。",
  approach: "设计对照实验，并注意样本量。",
  nextSteps: ["先定义测量指标", "检索相关文献", "进行小规模预实验"],
  keywords: ["对照实验", "科研方法"],
};
const databases = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});

// Execute the actual migration and repository SQL against SQLite, D1's SQL dialect.
function repository() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
    );
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...params) {
          values = params;
          return this;
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          return {
            meta: { changes: Number(statement.run(...values).changes) },
          };
        },
      };
    },
  };
  return { repository: new IdeaRepository(db), sqlite, db };
}
const input = (content = "一个还未完成的科研假设") => ({
  id: crypto.randomUUID(),
  content,
  tags: ["假设", "假设"],
});

test("validates input, trims text, and rejects empty, oversized, invalid IDs and excessive tags", () => {
  assert.equal(
    ideaInputSchema.parse({ ...input(), content: "  灵感  " }).content,
    "灵感",
  );
  for (const bad of [
    { content: "  " },
    { content: "字".repeat(12001) },
    { id: "../../x" },
    { tags: Array(9).fill("tag") },
    { tags: ["x".repeat(25)] },
  ])
    assert.equal(
      ideaInputSchema.safeParse({ ...input(), ...bad }).success,
      false,
    );
});

test("saves server timestamp, preserves original text, and deduplicates retries", async () => {
  const { repository: repo } = repository();
  const note = input("原文第一行\n原文第二行");
  const before = Date.now();
  const first = await repo.create("owner-a", note);
  const repeated = await repo.create("owner-a", {
    ...note,
    content: "不得覆盖原文",
  });
  assert.equal(first.content, note.content);
  assert.equal(first.title, "原文第一行");
  assert.deepEqual(first.tags, ["假设"]);
  assert.equal(first.status, "pending");
  assert.ok(Date.parse(first.createdAt) >= before);
  assert.equal(repeated.createdAt, first.createdAt);
  assert.equal(repeated.content, note.content);
  assert.equal((await repo.list("owner-a")).length, 1);
});

test("isolates each owner's reads, bookmarks, deletion and analysis writes", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner-a", input());
  assert.equal(await repo.find("owner-b", note.id), null);
  assert.equal((await repo.list("owner-b")).length, 0);
  assert.equal(await repo.bookmark("owner-b", note.id, true), null);
  assert.equal(await repo.remove("owner-b", note.id), false);
  assert.equal(await repo.claimAnalysis("owner-b", note.id, "job"), false);
  assert.equal(await repo.create("owner-b", { ...input(), id: note.id }), null);
  assert.equal((await repo.find("owner-a", note.id)).bookmarked, false);
});

test("sorts by timestamp, persists bookmarks and deletes only the selected record", async () => {
  const { repository: repo, sqlite } = repository();
  const one = await repo.create("owner", input("第一条"));
  const two = await repo.create("owner", input("第二条"));
  sqlite
    .prepare("UPDATE ideas SET created_at = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", one.id);
  assert.deepEqual(
    (await repo.list("owner")).map((item) => item.id),
    [two.id, one.id],
  );
  await repo.bookmark("owner", one.id, true);
  assert.equal((await repo.find("owner", one.id)).bookmarked, true);
  assert.equal(await repo.remove("owner", one.id), true);
  assert.equal((await repo.list("owner")).length, 1);
});

test("prevents duplicate AI requests and stores structured analysis with provenance", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  assert.equal(await repo.claimAnalysis("owner", note.id, "job-1"), true);
  assert.equal(await repo.claimAnalysis("owner", note.id, "job-2"), false);
  await repo.completeAnalysis(
    "owner",
    note.id,
    "job-1",
    analysis,
    "test-model",
  );
  const saved = await repo.find("owner", note.id);
  assert.equal(saved.status, "completed");
  assert.deepEqual(saved.analysis, analysis);
  assert.equal(saved.analysisModel, "test-model");
  assert.ok(saved.analyzedAt);
  assert.equal(saved.createdAt, note.createdAt);
  assert.equal(saved.content, note.content);
});

test("recovers expired analysis leases and ignores stale results", async () => {
  const { repository: repo, sqlite } = repository();
  const note = await repo.create("owner", input());
  await repo.claimAnalysis("owner", note.id, "old-job");
  sqlite
    .prepare("UPDATE ideas SET analysis_started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - ANALYSIS_LEASE_MS - 1).toISOString(), note.id);
  assert.equal(await repo.claimAnalysis("owner", note.id, "new-job"), true);
  await repo.completeAnalysis(
    "owner",
    note.id,
    "old-job",
    analysis,
    "stale-model",
  );
  assert.equal((await repo.find("owner", note.id)).status, "processing");
  await repo.completeAnalysis(
    "owner",
    note.id,
    "new-job",
    analysis,
    "current-model",
  );
  await repo.failAnalysis("owner", note.id, "old-job", "stale failure");
  assert.equal(
    (await repo.find("owner", note.id)).analysisModel,
    "current-model",
  );
  assert.equal((await repo.find("owner", note.id)).status, "completed");
});

test("AI failure preserves the original note and previous successful analysis", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  await repo.claimAnalysis("owner", note.id, "first-job");
  await repo.completeAnalysis(
    "owner",
    note.id,
    "first-job",
    analysis,
    "test-model",
  );
  await repo.claimAnalysis("owner", note.id, "retry-job");
  await repo.failAnalysis("owner", note.id, "retry-job", "服务暂时不可用");
  const saved = await repo.find("owner", note.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.content, note.content);
  assert.equal(saved.createdAt, note.createdAt);
  assert.deepEqual(saved.analysis, analysis);
});

test("AI configuration requires all values and rejects unsafe or malformed endpoints", () => {
  assert.equal(getAIConfig({}), null);
  assert.equal(getAIConfig({ AI_API_KEY: "key" }), null);
  for (const base of [
    "not-url",
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com?key=secret",
  ])
    assert.equal(
      getAIConfig({ AI_API_KEY: "key", AI_MODEL: "model", AI_BASE_URL: base }),
      null,
    );
  assert.deepEqual(
    getAIConfig({
      AI_API_KEY: " key ",
      AI_MODEL: " model ",
      AI_BASE_URL: "https://example.com/v1/",
    }),
    { key: "key", model: "model", baseURL: "https://example.com/v1" },
  );
});

test("accepts structured and fenced JSON but rejects incomplete model responses", () => {
  assert.deepEqual(parseAnalysis(JSON.stringify(analysis)), analysis);
  assert.deepEqual(
    parseAnalysis(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``),
    analysis,
  );
  assert.throws(() => parseAnalysis('{"title":"缺失内容"}'));
  assert.throws(() => parseAnalysis("plain prose"));
});

test("sends an OpenAI-compatible server request and parses the response", async () => {
  const result = await analyzeIdea(
    "测试灵感",
    {
      key: "test-only",
      model: "test-model",
      baseURL: "https://example.com/v1",
    },
    async (url, options) => {
      assert.equal(url, "https://example.com/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-only");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "test-model");
      assert.equal(body.messages[1].content, "测试灵感");
      assert.ok(options.signal);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(analysis) } }],
      });
    },
  );
  assert.deepEqual(result, analysis);
});

test("handles provider authentication, rate limit, malformed output and network failure", async () => {
  const config = {
    key: "test-only",
    model: "test-model",
    baseURL: "https://example.com/v1",
  };
  for (const status of [401, 403, 429, 500])
    await assert.rejects(
      analyzeIdea(
        "idea",
        config,
        async () => new Response("secret-provider-details", { status }),
      ),
      (error) => !error.message.includes("secret-provider-details"),
    );
  await assert.rejects(
    analyzeIdea("idea", config, async () => Response.json({ choices: [] })),
    /格式不完整/,
  );
  await assert.rejects(
    analyzeIdea("idea", config, async () => {
      throw new Error("network");
    }),
    /超时/,
  );
});

test("client shows stale analysis as retryable", () => {
  assert.equal(
    isAnalysisRunning({
      status: "processing",
      analysisStartedAt: new Date().toISOString(),
    }),
    true,
  );
  assert.equal(
    isAnalysisRunning({
      status: "processing",
      analysisStartedAt: new Date(
        Date.now() - ANALYSIS_LEASE_MS - 1,
      ).toISOString(),
    }),
    false,
  );
  assert.equal(
    isAnalysisRunning({ status: "pending", analysisStartedAt: null }),
    false,
  );
});

const secretEnvironment = { AI_SETTINGS_ENCRYPTION_KEY: "ab".repeat(32) };
const connectionInput = (overrides = {}) =>
  connectionInputSchema.parse({
    provider: "deepseek",
    model: "deepseek-flash",
    apiKey: "sk-test-only-1234567890",
    ...overrides,
  });

test("connection input validates credentials and rejects user-supplied endpoints", () => {
  assert.equal(
    connectionInput({ apiKey: "  sk-test-only-1234567890  " }).apiKey,
    "sk-test-only-1234567890",
  );
  assert.equal(connectionInput({ apiKey: undefined }).apiKey, "");
  for (const override of [
    { provider: "other" },
    { model: "" },
    { model: "../models" },
    { apiKey: "short" },
    { apiKey: "sk-key-with\nheader-injection" },
    { apiKey: "x".repeat(513) },
    { baseURL: "https://untrusted.example" },
  ])
    assert.throws(() => connectionInput(override));
});

test("encrypts persisted keys, returns only masked metadata and survives service reconstruction", async () => {
  const { db, sqlite } = repository();
  const service = new ConnectionService(db, secretEnvironment);
  await service.save("owner-a", connectionInput());
  const row = sqlite.prepare("SELECT * FROM ai_connections").get();
  assert.ok(row.encrypted_key.startsWith("v1."));
  assert.equal(JSON.stringify(row).includes(connectionInput().apiKey), false);
  const summary = await service.summary("owner-a", "研究者");
  assert.deepEqual(summary, {
    configured: true,
    model: "deepseek-flash",
    displayName: "研究者",
    provider: "deepseek",
    source: "saved",
    keyHint: "7890",
  });
  assert.equal(JSON.stringify(summary).includes(row.encrypted_key), false);
  const reloaded = new ConnectionService(db, secretEnvironment);
  assert.equal(
    (await reloaded.resolve("owner-a")).key,
    connectionInput().apiKey,
  );
  assert.equal(
    (await reloaded.resolve("owner-a")).baseURL,
    "https://api.deepseek.com",
  );
  await service.save("owner-a", connectionInput());
  assert.notEqual(
    sqlite.prepare("SELECT encrypted_key FROM ai_connections").get()
      .encrypted_key,
    row.encrypted_key,
  );
});

test("isolates credentials by user, retains an omitted key, replaces it and removes only that user's connection", async () => {
  const { db } = repository();
  const service = new ConnectionService(db, secretEnvironment);
  await service.save("owner-a", connectionInput());
  assert.equal(await service.resolve("owner-b"), null);
  await assert.rejects(
    service.save("owner-b", connectionInput({ apiKey: "" })),
    /先填写/,
  );
  await service.save(
    "owner-a",
    connectionInput({ apiKey: "", model: "deepseek-v4-pro" }),
  );
  assert.equal(
    (await service.resolve("owner-a")).key,
    connectionInput().apiKey,
  );
  assert.equal((await service.resolve("owner-a")).model, "deepseek-v4-pro");
  await service.save(
    "owner-b",
    connectionInput({ apiKey: "sk-owner-b-new-0000" }),
  );
  await service.save(
    "owner-a",
    connectionInput({ apiKey: "sk-replaced-new-1111" }),
  );
  assert.equal((await service.resolve("owner-a")).key, "sk-replaced-new-1111");
  await service.remove("owner-a");
  assert.equal(await service.resolve("owner-a"), null);
  assert.equal((await service.resolve("owner-b")).key, "sk-owner-b-new-0000");
});

test("rejects wrong wrapping keys and copied ciphertext; replacing a key repairs the saved configuration", async () => {
  const { db, sqlite } = repository();
  const service = new ConnectionService(db, secretEnvironment);
  await service.save("owner-a", connectionInput());
  const rotated = new ConnectionService(db, {
    AI_SETTINGS_ENCRYPTION_KEY: "cd".repeat(32),
  });
  await assert.rejects(rotated.resolve("owner-a"), /重新填写/);
  sqlite
    .prepare("UPDATE ai_connections SET owner_id = ? WHERE owner_id = ?")
    .run("owner-b", "owner-a");
  await assert.rejects(service.resolve("owner-b"), /重新填写/);
  await service.save(
    "owner-b",
    connectionInput({ apiKey: "sk-repaired-key-1111" }),
  );
  assert.equal((await service.resolve("owner-b")).key, "sk-repaired-key-1111");
});

test("missing encryption configuration does not store a plaintext key", async () => {
  const { db, sqlite } = repository();
  const service = new ConnectionService(db, {});
  await assert.rejects(
    service.save("owner", connectionInput()),
    /存储尚未就绪/,
  );
  assert.equal(
    sqlite.prepare("SELECT count(*) AS count FROM ai_connections").get().count,
    0,
  );
});

test("saved connections override environment settings and removal restores the fallback", async () => {
  const { db } = repository();
  const env = {
    ...secretEnvironment,
    AI_BASE_URL: "https://compatible.example/v1",
    AI_MODEL: "fallback",
    AI_API_KEY: "fallback-only",
  };
  const service = new ConnectionService(db, env);
  assert.equal(
    (await service.summary("owner", "Researcher")).source,
    "environment",
  );
  await service.save("owner", connectionInput());
  assert.equal((await service.resolve("owner")).model, "deepseek-flash");
  await service.remove("owner");
  assert.equal((await service.resolve("owner")).model, "fallback");
});

test("tests unsaved or retained credentials without persisting or sending any research content", async () => {
  const { db } = repository();
  const service = new ConnectionService(db, secretEnvironment);
  const config = await service.candidate("owner", connectionInput());
  const result = await testDeepSeekConnection(config, async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/models");
    assert.equal(
      options.headers.Authorization,
      `Bearer ${connectionInput().apiKey}`,
    );
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return Response.json({ data: [{ id: config.model }] });
  });
  assert.equal(result.ok, true);
  assert.equal((await service.summary("owner", "R")).configured, false);
  await service.save("owner", connectionInput());
  const retained = await service.candidate(
    "owner",
    connectionInput({ apiKey: "" }),
  );
  assert.equal(retained.key, config.key);
});

test("connection probe sanitizes authentication, rate limit, unsupported model, malformed response and network errors", async () => {
  const config = {
    key: "sk-not-printed",
    model: "deepseek-flash",
    baseURL: "https://api.deepseek.com",
  };
  for (const [upstream, status] of [
    [401, 422],
    [403, 422],
    [429, 429],
    [500, 502],
  ]) {
    await assert.rejects(
      testDeepSeekConnection(
        config,
        async () => new Response(config.key, { status: upstream }),
      ),
      (error) => error.status === status && !error.message.includes(config.key),
    );
  }
  await assert.rejects(
    testDeepSeekConnection(config, async () =>
      Response.json({ data: [{ id: "other" }] }),
    ),
    /所选模型/,
  );
  await assert.rejects(
    testDeepSeekConnection(config, async () =>
      Response.json({ data: "invalid" }),
    ),
    /无法读取/,
  );
  await assert.rejects(
    testDeepSeekConnection(config, async () => {
      throw new Error(config.key);
    }),
    /检查网络/,
  );
});

test("saved DeepSeek credentials are used for structured, non-thinking analysis", async () => {
  const { db, repository: ideas } = repository();
  const service = new ConnectionService(db, secretEnvironment);
  await service.save("owner", connectionInput());
  const idea = await ideas.create("owner", input("测试一条真实保存的灵感"));
  const result = await analyzeIdea(
    idea.content,
    await service.resolve("owner"),
    async (url, options) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(
        options.headers.Authorization,
        `Bearer ${connectionInput().apiKey}`,
      );
      const body = JSON.parse(options.body);
      assert.equal(body.model, "deepseek-flash");
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body.messages[1].content, idea.content);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(analysis) } }],
      });
    },
  );
  assert.deepEqual(result, analysis);
});

test("local startup creates a persistent private wrapping key without overwriting other settings", () => {
  const root = mkdtempSync(path.join(tmpdir(), "trace-secret-test-"));
  try {
    const file = path.join(root, ".dev.vars");
    writeFileSync(file, 'AI_MODEL="preserve-this"\n');
    ensureLocalEncryptionKey(root, {});
    const first = readFileSync(file, "utf8");
    assert.match(first, /AI_SETTINGS_ENCRYPTION_KEY="[a-f0-9]{64}"/);
    assert.ok(first.startsWith('AI_MODEL="preserve-this"\n'));
    ensureLocalEncryptionKey(root, {});
    assert.equal(readFileSync(file, "utf8"), first);
    if (process.platform !== "win32")
      assert.equal(statSync(file).mode & 0o777, 0o600);
    writeFileSync(
      file,
      'AI_SETTINGS_ENCRYPTION_KEY="invalid-but-never-silently-rotated"\n',
    );
    ensureLocalEncryptionKey(root, {});
    assert.equal(
      readFileSync(file, "utf8"),
      'AI_SETTINGS_ENCRYPTION_KEY="invalid-but-never-silently-rotated"\n',
    );
    writeFileSync(file, "");
    ensureLocalEncryptionKey(root, secretEnvironment);
    assert.ok(
      readFileSync(file, "utf8").includes(
        secretEnvironment.AI_SETTINGS_ENCRYPTION_KEY,
      ),
    );
    if (process.platform !== "win32")
      assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
