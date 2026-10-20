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
  ideaEditSchema,
  ideaRestoreSchema,
  ideaTitle,
  newerIdea,
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
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
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
  assert.equal(
    await repo.claimAnalysis("owner-b", note.id, "job", note.revision),
    false,
  );
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
  assert.equal(
    await repo.claimAnalysis("owner", note.id, "job-1", note.revision),
    true,
  );
  assert.equal(
    await repo.claimAnalysis("owner", note.id, "job-2", note.revision),
    false,
  );
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
  await repo.claimAnalysis("owner", note.id, "old-job", note.revision);
  sqlite
    .prepare("UPDATE ideas SET analysis_started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - ANALYSIS_LEASE_MS - 1).toISOString(), note.id);
  assert.equal(
    await repo.claimAnalysis("owner", note.id, "new-job", note.revision),
    true,
  );
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
  await repo.claimAnalysis("owner", note.id, "first-job", note.revision);
  await repo.completeAnalysis(
    "owner",
    note.id,
    "first-job",
    analysis,
    "test-model",
  );
  await repo.claimAnalysis("owner", note.id, "retry-job", note.revision);
  await repo.failAnalysis("owner", note.id, "retry-job", "服务暂时不可用");
  const saved = await repo.find("owner", note.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.content, note.content);
  assert.equal(saved.createdAt, note.createdAt);
  assert.deepEqual(saved.analysis, analysis);
});

test("edit validation rejects empty content, invalid revisions and protected fields", () => {
  const edit = { content: "  修改后的想法  ", tags: ["关键词"], revision: 1 };
  assert.equal(ideaEditSchema.parse(edit).content, "修改后的想法");
  for (const bad of [
    { content: "  " },
    { content: "字".repeat(12001) },
    { tags: ["字".repeat(25)] },
    { tags: Array(9).fill("tag") },
    { revision: 0 },
    { revision: 1.5 },
    { revision: undefined },
    { createdAt: "2020-01-01T00:00:00Z" },
    { analysis },
    { bookmarked: true },
    { ownerId: "another-owner" },
  ])
    assert.equal(ideaEditSchema.safeParse({ ...edit, ...bad }).success, false);
});

test("edits in place, preserves creation and bookmarks, and keeps retry saves idempotent", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  await repo.bookmark("owner", note.id, true);
  const edit = {
    revision: note.revision,
    content: "新的实验方向\n添加对照组",
    tags: ["对照", "对照"],
  };
  const { idea: saved, conflict } = await repo.edit("owner", note.id, edit);
  assert.equal(conflict, false);
  assert.equal(saved.id, note.id);
  assert.equal(saved.createdAt, note.createdAt);
  assert.equal(saved.bookmarked, true);
  assert.equal(saved.title, "新的实验方向");
  assert.equal(saved.content, edit.content);
  assert.deepEqual(saved.tags, ["对照"]);
  assert.equal(saved.revision, note.revision + 1);
  assert.equal(saved.analysisStale, false);
  assert.equal((await repo.list("owner")).length, 1);
  const retried = await repo.edit("owner", note.id, edit);
  assert.equal(retried.conflict, false);
  assert.deepEqual(retried.idea, saved);
  assert.equal((await repo.edit("other-owner", note.id, edit)).idea, null);
  const conflicting = await repo.edit("owner", note.id, {
    ...edit,
    content: "旧页面中的草稿",
  });
  assert.equal(conflicting.conflict, true);
  assert.deepEqual(conflicting.idea, saved);
  await repo.remove("owner", note.id);
  assert.equal((await repo.edit("owner", note.id, edit)).idea, null);
});

test("edits mark prior analysis stale; failed regeneration preserves it until a fresh result succeeds", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  await repo.claimAnalysis("owner", note.id, "initial", note.revision);
  await repo.completeAnalysis(
    "owner",
    note.id,
    "initial",
    analysis,
    "initial-model",
  );
  const { idea: edited } = await repo.edit("owner", note.id, {
    revision: note.revision,
    content: "修改后的研究方向",
    tags: [],
  });
  assert.equal(edited.status, "pending");
  assert.equal(edited.analysisStale, true);
  assert.deepEqual(edited.analysis, analysis);
  assert.equal(ideaTitle(edited), edited.title);
  await repo.claimAnalysis("owner", note.id, "retry", edited.revision);
  await repo.failAnalysis("owner", note.id, "retry", "模拟分析失败");
  const failed = await repo.find("owner", note.id);
  assert.equal(failed.content, edited.content);
  assert.equal(failed.analysisStale, true);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.analysis, analysis);
  await repo.claimAnalysis("owner", note.id, "fresh", edited.revision);
  const fresh = { ...analysis, title: "新方向的分析" };
  await repo.completeAnalysis("owner", note.id, "fresh", fresh, "new-model");
  const completed = await repo.find("owner", note.id);
  assert.equal(completed.analysisStale, false);
  assert.equal(completed.status, "completed");
  assert.equal(completed.analysisStartedAt, null);
  assert.equal(ideaTitle(completed), fresh.title);
  assert.equal(completed.content, edited.content);
});

test("edits cancel earlier jobs and reject analysis claims against an old snapshot", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  await repo.claimAnalysis("owner", note.id, "old", note.revision);
  const { idea: edited } = await repo.edit("owner", note.id, {
    revision: note.revision,
    content: "分析中修改后的内容",
    tags: [],
  });
  assert.equal(edited.analysisStartedAt, null);
  assert.equal(
    await repo.claimAnalysis("owner", note.id, "outdated-claim", note.revision),
    false,
  );
  assert.equal(
    await repo.claimAnalysis("owner", note.id, "new", edited.revision),
    true,
  );
  assert.equal(
    await repo.completeAnalysis("owner", note.id, "old", analysis, "old-model"),
    false,
  );
  assert.equal(
    await repo.failAnalysis("owner", note.id, "old", "过期错误"),
    false,
  );
  const running = await repo.find("owner", note.id);
  assert.equal(running.status, "processing");
  assert.equal(running.analysis, null);
  assert.equal(running.error, null);
  assert.equal(
    await repo.completeAnalysis("owner", note.id, "new", analysis, "new-model"),
    true,
  );
  assert.equal((await repo.find("owner", note.id)).analysisModel, "new-model");
});

test("unchanged saves leave a completed or running analysis intact", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  await repo.claimAnalysis("owner", note.id, "job", note.revision);
  const edit = {
    revision: note.revision,
    content: note.content,
    tags: note.tags,
  };
  const same = await repo.edit("owner", note.id, edit);
  assert.equal(same.idea.revision, note.revision);
  assert.equal(same.idea.status, "processing");
  await repo.completeAnalysis("owner", note.id, "job", analysis, "model");
  assert.equal(
    (await repo.edit("owner", note.id, edit)).idea.status,
    "completed",
  );
});

test("late responses cannot replace a newer revision or a newer same-revision result", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  const edited = { ...note, content: "新想法", revision: note.revision + 1 };
  assert.equal(newerIdea(edited, { ...note, updatedAt: "2099-01-01" }), edited);
  assert.equal(newerIdea(note, edited), edited);
  const fresh = { ...edited, updatedAt: "2099-01-01" };
  assert.equal(newerIdea(fresh, edited), fresh);
  assert.equal(newerIdea(undefined, note), note);
});

test("archives exact pre-edit content and AI provenance once, without recording no-op saves or conflicts", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input("第一版想法"));
  assert.deepEqual((await repo.history("owner", note.id)).versions, []);
  await repo.claimAnalysis("owner", note.id, "job", note.revision);
  await repo.completeAnalysis(
    "owner",
    note.id,
    "job",
    analysis,
    "version-one-model",
  );
  const before = await repo.find("owner", note.id);
  const edit = {
    content: "第二版想法",
    tags: ["新关键词"],
    revision: note.revision,
  };
  const { idea: second } = await repo.edit("owner", note.id, edit);
  const firstHistory = await repo.history("owner", note.id);
  assert.deepEqual(firstHistory.idea, second);
  assert.deepEqual(firstHistory.versions[0].idea, before);
  assert.ok(
    Date.parse(firstHistory.versions[0].archivedAt) >=
      Date.parse(before.updatedAt),
  );
  await repo.edit("owner", note.id, edit);
  await repo.edit("owner", note.id, { ...edit, content: "冲突的草稿" });
  await repo.bookmark("owner", note.id, true);
  assert.equal((await repo.history("owner", note.id)).versions.length, 1);
  await repo.claimAnalysis("owner", note.id, "second-job", second.revision);
  await repo.completeAnalysis(
    "owner",
    note.id,
    "second-job",
    { ...analysis, title: "第二版的分析" },
    "version-two-model",
  );
  await repo.edit("owner", note.id, {
    ...edit,
    content: "第三版",
    revision: second.revision,
  });
  const history = await repo.history("owner", note.id);
  assert.deepEqual(
    history.versions.map((v) => v.idea.revision),
    [2, 1],
  );
  assert.equal(history.versions[0].idea.analysis.title, "第二版的分析");
  assert.deepEqual(history.versions[1], firstHistory.versions[0]);
});

test("restores content, tags and matching analysis as a new version and preserves both directions of history", async () => {
  const { repository: repo } = repository();
  const original = await repo.create("owner", input("原始想法"));
  await repo.claimAnalysis("owner", original.id, "original-analysis", 1);
  await repo.completeAnalysis(
    "owner",
    original.id,
    "original-analysis",
    analysis,
    "original-model",
  );
  const originalWithAnalysis = await repo.find("owner", original.id);
  const { idea: edited } = await repo.edit("owner", original.id, {
    content: "修改后的想法",
    tags: ["修改"],
    revision: 1,
  });
  await repo.bookmark("owner", original.id, true);
  const result = await repo.restore("owner", original.id, {
    versionRevision: 1,
    revision: edited.revision,
    requestId: crypto.randomUUID(),
  });
  assert.equal(result.conflict, false);
  assert.equal(result.idea.revision, 3);
  assert.equal(result.idea.restoredFromRevision, 1);
  assert.equal(result.idea.id, original.id);
  assert.equal(result.idea.content, original.content);
  assert.deepEqual(result.idea.tags, original.tags);
  assert.equal(result.idea.createdAt, original.createdAt);
  assert.equal(result.idea.bookmarked, true);
  assert.deepEqual(result.idea.analysis, analysis);
  assert.equal(result.idea.analysisModel, originalWithAnalysis.analysisModel);
  assert.equal(result.idea.analyzedAt, originalWithAnalysis.analyzedAt);
  assert.equal(result.idea.analysisStale, false);
  assert.equal(result.idea.status, "completed");
  assert.deepEqual(
    (await repo.history("owner", original.id)).versions.map(
      (v) => v.idea.revision,
    ),
    [2, 1],
  );
  const forward = await repo.restore("owner", original.id, {
    versionRevision: 2,
    revision: 3,
    requestId: crypto.randomUUID(),
  });
  assert.equal(forward.idea.content, edited.content);
  assert.deepEqual(forward.idea.tags, edited.tags);
  assert.equal(forward.idea.analysisStale, true);
  assert.equal(forward.idea.revision, 4);
  assert.equal((await repo.history("owner", original.id)).versions.length, 3);
  const { idea: newEdit } = await repo.edit("owner", original.id, {
    revision: 4,
    content: "恢复后继续编辑",
    tags: [],
  });
  assert.equal(newEdit.restoredFromRevision, null);
  assert.equal(
    (await repo.history("owner", original.id)).versions[0].idea
      .restoredFromRevision,
    2,
  );
});

test("restore retries are idempotent and outdated restore requests cannot overwrite a later edit", async () => {
  const { repository: repo } = repository();
  const original = await repo.create("owner", input());
  await repo.edit("owner", original.id, {
    revision: 1,
    content: "第二版",
    tags: [],
  });
  const request = {
    versionRevision: 1,
    revision: 2,
    requestId: crypto.randomUUID(),
  };
  const once = await repo.restore("owner", original.id, request);
  const twice = await repo.restore("owner", original.id, request);
  assert.equal(twice.conflict, false);
  assert.deepEqual(twice.idea, once.idea);
  assert.equal((await repo.history("owner", original.id)).versions.length, 2);
  const { idea: edited } = await repo.edit("owner", original.id, {
    revision: 3,
    content: "另一页面的新内容",
    tags: [],
  });
  const stale = await repo.restore("owner", original.id, request);
  assert.equal(stale.conflict, true);
  assert.deepEqual(stale.idea, edited);
  assert.equal((await repo.history("owner", original.id)).versions.length, 3);
});

test("restoring cancels active AI jobs and never resumes a historical processing job", async () => {
  const { repository: repo } = repository();
  const original = await repo.create("owner", input());
  await repo.claimAnalysis("owner", original.id, "old-job", 1);
  await repo.edit("owner", original.id, {
    revision: 1,
    content: "第二版",
    tags: [],
  });
  await repo.claimAnalysis("owner", original.id, "current-job", 2);
  const restored = await repo.restore("owner", original.id, {
    versionRevision: 1,
    revision: 2,
    requestId: crypto.randomUUID(),
  });
  assert.equal(restored.idea.status, "pending");
  assert.equal(restored.idea.analysisStartedAt, null);
  assert.equal(restored.idea.analysis, null);
  assert.equal(
    await repo.completeAnalysis(
      "owner",
      original.id,
      "old-job",
      analysis,
      "outdated",
    ),
    false,
  );
  assert.equal(
    await repo.completeAnalysis(
      "owner",
      original.id,
      "current-job",
      analysis,
      "outdated",
    ),
    false,
  );
  assert.equal(
    await repo.failAnalysis("owner", original.id, "current-job", "outdated"),
    false,
  );
  const historical = (await repo.history("owner", original.id)).versions;
  assert.ok(
    historical.every(
      (v) => v.idea.status === "processing" && v.idea.analysis === null,
    ),
  );
  assert.equal(
    await repo.claimAnalysis("owner", original.id, "fresh-job", 3),
    true,
  );
});

test("failed restoration remains an exact snapshot, including stale analysis and its error", async () => {
  const { repository: repo } = repository();
  const note = await repo.create("owner", input());
  await repo.claimAnalysis("owner", note.id, "first", 1);
  await repo.completeAnalysis("owner", note.id, "first", analysis, "model");
  await repo.edit("owner", note.id, {
    revision: 1,
    content: "第二版",
    tags: [],
  });
  await repo.claimAnalysis("owner", note.id, "failed", 2);
  await repo.failAnalysis("owner", note.id, "failed", "暂时无法分析");
  const failed = await repo.find("owner", note.id);
  await repo.edit("owner", note.id, {
    revision: 2,
    content: "第三版",
    tags: [],
  });
  const result = await repo.restore("owner", note.id, {
    revision: 3,
    versionRevision: 2,
    requestId: crypto.randomUUID(),
  });
  assert.equal(result.idea.content, failed.content);
  assert.equal(result.idea.status, "failed");
  assert.equal(result.idea.error, failed.error);
  assert.equal(result.idea.analysisStale, true);
  assert.deepEqual(result.idea.analysis, failed.analysis);
});

test("history and live changes roll back together if saving either part fails", async () => {
  const { repository: repo, sqlite } = repository();
  const note = await repo.create("owner", input());
  sqlite.exec(
    "CREATE TRIGGER reject_edit BEFORE UPDATE OF content ON ideas BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
  );
  await assert.rejects(
    () =>
      repo.edit("owner", note.id, {
        revision: 1,
        content: "未能保存",
        tags: [],
      }),
    /simulated write failure/,
  );
  assert.deepEqual(await repo.find("owner", note.id), note);
  assert.equal((await repo.history("owner", note.id)).versions.length, 0);
  sqlite.exec("DROP TRIGGER reject_edit;");
  const { idea: edited } = await repo.edit("owner", note.id, {
    revision: 1,
    content: "第二版",
    tags: [],
  });
  sqlite.exec(
    "CREATE TRIGGER reject_restore BEFORE UPDATE OF content ON ideas BEGIN SELECT RAISE(ABORT, 'simulated restore failure'); END;",
  );
  await assert.rejects(
    () =>
      repo.restore("owner", note.id, {
        revision: 2,
        versionRevision: 1,
        requestId: crypto.randomUUID(),
      }),
    /simulated restore failure/,
  );
  assert.deepEqual(await repo.find("owner", note.id), edited);
  assert.equal((await repo.history("owner", note.id)).versions.length, 1);
  sqlite.exec(
    "DROP TRIGGER reject_restore; CREATE TRIGGER reject_snapshot BEFORE INSERT ON idea_versions BEGIN SELECT RAISE(ABORT, 'simulated archive failure'); END;",
  );
  await assert.rejects(
    () =>
      repo.edit("owner", note.id, { revision: 2, content: "第三版", tags: [] }),
    /simulated archive failure/,
  );
  assert.deepEqual(await repo.find("owner", note.id), edited);
});

test("history is owner-scoped, exports include snapshots without private jobs, and deletion removes snapshots", async () => {
  const { repository: repo, sqlite } = repository();
  const mine = await repo.create("owner", input("我的第一版"));
  const other = await repo.create("another", input("别人的第一版"));
  await repo.edit("owner", mine.id, {
    revision: 1,
    content: "我的第二版",
    tags: [],
  });
  await repo.edit("another", other.id, {
    revision: 1,
    content: "别人的第二版",
    tags: [],
  });
  assert.equal(await repo.history("another", mine.id), null);
  assert.equal(
    (
      await repo.restore("another", mine.id, {
        revision: 2,
        versionRevision: 1,
        requestId: crypto.randomUUID(),
      })
    ).idea,
    null,
  );
  const missing = await repo.restore("owner", mine.id, {
    revision: 2,
    versionRevision: 99,
    requestId: crypto.randomUUID(),
  });
  assert.equal(missing.missingVersion, true);
  assert.equal(missing.idea.revision, 2);
  const exported = await repo.export("owner");
  assert.deepEqual(
    exported.ideas.map((idea) => idea.id),
    [mine.id],
  );
  assert.deepEqual(
    exported.history.map((v) => v.idea.id),
    [mine.id],
  );
  assert.doesNotMatch(
    JSON.stringify(exported),
    /restore_request_id|analysis_job|owner_id/,
  );
  await repo.remove("owner", mine.id);
  assert.equal(await repo.history("owner", mine.id), null);
  assert.deepEqual(await repo.export("owner"), { ideas: [], history: [] });
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS count FROM idea_versions WHERE idea_id = ?")
      .get(mine.id).count,
    0,
  );
  assert.equal((await repo.history("another", other.id)).versions.length, 1);
});

test("restoration accepts only a selected version and concurrency token, not client-supplied content", () => {
  const request = {
    revision: 2,
    versionRevision: 1,
    requestId: crypto.randomUUID(),
  };
  assert.equal(ideaRestoreSchema.safeParse(request).success, true);
  for (const invalid of [
    { versionRevision: 0 },
    { versionRevision: 1.2 },
    { revision: 0 },
    { requestId: undefined },
    { requestId: "invalid" },
    { content: "伪造的历史" },
    { analysis },
    { createdAt: "fake" },
  ])
    assert.equal(
      ideaRestoreSchema.safeParse({ ...request, ...invalid }).success,
      false,
    );
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
    assert.equal(options.redirect, "manual");
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
