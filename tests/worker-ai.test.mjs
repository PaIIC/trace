import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Use the actual runtime bundled with Wrangler, and the compiler bundled with
// tsx. Keeping these tied to the app's installed tools avoids testing a different
// Worker version. Node fetch mocks alone cannot catch unsupported Worker options.
const require = createRequire(import.meta.url);
const { Miniflare, Log, LogLevel } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare");
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");

const config = {
  key: "sk-worker-regression-only",
  model: "deepseek-flash",
  provider: "deepseek",
  baseURL: "https://api.deepseek.com",
};
const analysis = {
  title: "验证假设",
  summary: "仍需验证的研究思路。",
  question: "改变条件是否影响结果？",
  value: "验证一个可检验的假设。",
  approach: "设计小规模对照实验。",
  nextSteps: ["定义测量指标"],
  keywords: ["对照实验"],
};
let script;

before(async () => {
  const result = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: `
        import { testDeepSeekConnection } from './lib/ai-connections.ts';
        import { analyzeIdea } from './lib/ai.ts';
        export default {
          async fetch(request) {
            const { config } = await request.json();
            try {
              const result = new URL(request.url).pathname === '/test'
                ? await testDeepSeekConnection(config)
                : await analyzeIdea('一个用于测试的研究假设', config);
              return Response.json(result);
            } catch (error) {
              return Response.json({ error: error.message }, { status: error.status ?? 502 });
            }
          }
        }`,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  script = result.outputFiles[0].text;
});

async function worker(t, outboundService) {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    script,
    // Return upstream responses directly. Miniflare's fetchMock adapter uses
    // Node fetch and follows redirects before the Worker can inspect them.
    // This service intercepts every outbound request without using the network.
    outboundService,
    log: new Log(LogLevel.ERROR),
    cf: false,
  });
  t.after(() => mf.dispose());
  return {
    request: (path) =>
      mf.dispatchFetch(`http://worker.test${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      }),
  };
}

test("connection probe reaches the provider using native Worker fetch", async (t) => {
  let calls = 0;
  const { request } = await worker(t, (req) => {
    calls++;
    assert.equal(req.url, `${config.baseURL}/models`);
    assert.equal(req.method, "GET");
    assert.equal(req.headers.get("authorization"), `Bearer ${config.key}`);
    return Response.json({ data: [{ id: config.model }] });
  });
  const response = await request("/test");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls, 1);
});

test("structured analysis reaches the provider using native Worker fetch", async (t) => {
  let calls = 0;
  const { request } = await worker(t, async (req) => {
    calls++;
    assert.equal(req.url, `${config.baseURL}/chat/completions`);
    assert.equal(req.method, "POST");
    assert.equal(req.headers.get("authorization"), `Bearer ${config.key}`);
    const body = await req.json();
    assert.equal(body.model, config.model);
    assert.equal(body.messages[1].content, "一个用于测试的研究假设");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(analysis) } }],
    });
  });
  const response = await request("/analyze");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), analysis);
  assert.equal(calls, 1);
});

test("both Worker requests reject redirects without sending credentials to their targets", async (t) => {
  let unexpectedRequests = 0;
  let upstreamStatus;
  const { request } = await worker(t, (req) => {
    if (new URL(req.url).origin !== config.baseURL) {
      unexpectedRequests++;
      return Response.json({});
    }
    return new Response(null, {
      status: upstreamStatus,
      headers: { Location: "https://redirect-target.invalid/capture" },
    });
  });
  for (const status of [301, 302, 303, 307, 308]) {
    upstreamStatus = status;
    for (const path of ["/test", "/analyze"]) {
      const response = await request(path);
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /非预期的跳转/);
    }
  }
  assert.equal(unexpectedRequests, 0);
});
