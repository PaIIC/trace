import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Idea } from "../lib/domain";

const prefix = `[编辑测试 ${Date.now()}]`;
const createdIds = new Set<string>();
const editor = (page: Page) =>
  page.getByRole("dialog", { name: "编辑灵感", exact: true });
const newContent = `${prefix} 修改后的假设\n加入对照组和测量指标。`;
const analysis = {
  title: "更新后的研究问题",
  summary: "根据新的对照组设计生成的分析。",
  question: "加入对照组后，结论是否成立？",
  value: "识别潜在的混杂因素，仍需验证。",
  approach: "控制变量并比较两组测量结果。",
  nextSteps: ["确定测量指标", "开展预实验"],
  keywords: ["对照组"],
};

async function prepare(page: Page): Promise<Idea> {
  // Block generation by default, even if this instance has a real API key.
  await page.route("**/api/ideas/*/analyze", (route) =>
    route.fulfill({ status: 503, json: { error: "测试已阻止真实模型调用" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  const id = crypto.randomUUID();
  createdIds.add(id);
  const result = await page.request.post("/api/ideas", {
    data: { id, content: `${prefix} 初始假设`, tags: ["初稿"] },
  });
  expect(result.status()).toBe(201);
  const { idea } = await result.json();
  await page.goto(`/ideas/${id}`);
  await expect(page.locator(".original-text")).toHaveText(idea.content);
  return idea;
}

async function read(page: Page, id: string): Promise<Idea> {
  return (await (await page.request.get(`/api/ideas/${id}`)).json()).idea;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  for (const id of createdIds) await page.request.delete(`/api/ideas/${id}`);
  createdIds.clear();
});

test("edits from the timeline, bookmarks and detail while retaining timestamp and identity", async ({
  page,
}) => {
  const original = await prepare(page);
  await page.getByRole("button", { name: "收藏灵感", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "返回灵感轨迹" }).click();
  const count = (await (await page.request.get("/api/ideas")).json()).ideas
    .length;
  await page.getByLabel("搜索灵感或关键词").fill(prefix);
  const card = page.locator(".idea-card").filter({ hasText: prefix });
  await card.getByRole("button", { name: "编辑灵感", exact: true }).click();
  const dialog = editor(page);
  await expect(dialog.getByLabel("修改灵感内容")).toHaveValue(original.content);
  await expect(dialog.locator("time")).toHaveAttribute(
    "datetime",
    original.createdAt,
  );
  await dialog.getByLabel("修改灵感内容").fill(newContent);
  await dialog
    .getByLabel("修改灵感关键词，用逗号分隔")
    .fill("对照组，方法,方法");
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText(newContent);
  await expect(
    card.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeVisible();
  const saved = await read(page, original.id);
  expect(saved.content).toBe(newContent);
  expect(saved.tags).toEqual(["对照组", "方法"]);
  expect(saved.createdAt).toBe(original.createdAt);
  expect(saved.bookmarked).toBe(true);
  expect(saved.revision).toBe(original.revision + 1);
  expect(
    (await (await page.request.get("/api/ideas")).json()).ideas.length,
  ).toBe(count);
  await page.getByRole("button", { name: /^我的收藏/ }).click();
  await card.getByRole("button", { name: "编辑灵感", exact: true }).click();
  await dialog.getByLabel("修改灵感内容").fill(`${newContent}\n收藏中的补充`);
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^我的收藏/ })).toHaveClass(
    /active/,
  );
  await card.locator(".idea-card-main").click();
  await page.reload();
  await expect(page.locator(".original-text")).toContainText("收藏中的补充");
  await expect(page.locator(".detail-meta time")).toHaveAttribute(
    "datetime",
    original.createdAt,
  );
  await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
  await expect(dialog.getByLabel("修改灵感内容")).toHaveValue(/收藏中的补充/);
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(dialog).toHaveCount(0);
});

test("validates edits, confirms discard and preserves drafts on a lost save response", async ({
  page,
}) => {
  const original = await prepare(page);
  await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
  const dialog = editor(page);
  const content = dialog.getByLabel("修改灵感内容");
  await content.fill("  ");
  await expect(
    dialog.getByRole("button", { name: "保存修改", exact: true }),
  ).toBeDisabled();
  await content.fill(newContent);
  await dialog.getByLabel("修改灵感关键词，用逗号分隔").fill("字".repeat(25));
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("每个不超过 24 字");
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: "放弃修改" })).toBeVisible();
  expect((await read(page, original.id)).content).toBe(original.content);
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(content).toHaveValue(newContent);
  await dialog.getByLabel("修改灵感关键词，用逗号分隔").fill("新标签");
  let commit = false;
  await page.route(`**/api/ideas/${original.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    if (commit) await route.fetch();
    await route.abort("failed");
  });
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络暂时不可用");
  await expect(content).toHaveValue(newContent);
  expect((await read(page, original.id)).content).toBe(original.content);
  commit = true;
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络暂时不可用");
  await expect
    .poll(async () => (await read(page, original.id)).revision)
    .toBe(2);
  await page.unroute(`**/api/ideas/${original.id}`);
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read(page, original.id)).revision).toBe(2);
  await expect(page.locator(".original-text")).toHaveText(newContent);
  await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
  await dialog.getByLabel("修改灵感内容").fill("放弃的草稿");
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "放弃修改" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read(page, original.id)).content).toBe(newContent);
});

test("detects another tab's edit and lets the user compare it without losing their draft", async ({
  page,
}) => {
  const original = await prepare(page);
  await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
  const dialog = editor(page);
  await dialog.getByLabel("修改灵感内容").fill(newContent);
  const other = await page.request.patch(`/api/ideas/${original.id}`, {
    data: {
      revision: original.revision,
      content: `${prefix} 另一页面的更新`,
      tags: [],
    },
  });
  expect(other.status()).toBe(200);
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("其他页面修改");
  await expect(dialog.getByLabel("修改灵感内容")).toHaveValue(newContent);
  await dialog.getByRole("button", { name: "查看最新内容" }).click();
  await expect(dialog.locator(".edit-conflict")).toContainText(
    "另一页面的更新",
  );
  await dialog
    .getByRole("button", { name: "已查看，保留我的草稿继续编辑" })
    .click();
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read(page, original.id)).content).toBe(newContent);
});

test("API rejects malformed edits, protected fields and stale analysis requests", async ({
  page,
}) => {
  const original = await prepare(page);
  const data = { revision: original.revision, content: newContent, tags: [] };
  for (const invalid of [
    { ...data, content: "" },
    { ...data, revision: 0 },
    { ...data, content: "字".repeat(12001) },
    { ...data, tags: Array(9).fill("tag") },
    { ...data, createdAt: "2020-01-01T00:00:00Z" },
    { ...data, bookmarked: true },
    { ...data, analysis },
    null,
  ]) {
    const response = await page.request.patch(`/api/ideas/${original.id}`, {
      data: JSON.stringify(invalid),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status()).toBe(400);
  }
  expect((await read(page, original.id)).content).toBe(original.content);
  expect(
    (
      await page.request.patch(`/api/ideas/${crypto.randomUUID()}`, { data })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.patch(`/api/ideas/${original.id}`, {
        data,
        headers: { Origin: "https://invalid.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await page.request.patch(`/api/ideas/${original.id}`, { data })).status(),
  ).toBe(200);
  // This request is rejected before any provider connection or paid inference.
  expect(
    (
      await page.request.post(`/api/ideas/${original.id}/analyze`, {
        data: { revision: original.revision },
      })
    ).status(),
  ).toBe(409);
});

test("saves the edited text before requesting analysis for its new revision", async ({
  page,
}) => {
  const original = await prepare(page);
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { configured: true, model: "test-model", displayName: "测试" },
    }),
  );
  let requestedContent = "";
  await page.route(`**/api/ideas/${original.id}/analyze`, async (route) => {
    const saved = await read(page, original.id);
    requestedContent = saved.content;
    expect(route.request().postDataJSON()).toEqual({
      revision: saved.revision,
    });
    expect(saved.revision).toBe(original.revision + 1);
    await route.fulfill({
      json: {
        idea: {
          ...saved,
          analysis,
          analysisStale: false,
          status: "completed",
          analysisModel: "test-model",
          analyzedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
  await editor(page).getByLabel("修改灵感内容").fill(newContent);
  await editor(page).getByRole("button", { name: "保存并重新分析" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator(".analysis-summary")).toContainText(
    analysis.summary,
  );
  await expect(page.locator("h1")).toHaveText(analysis.title);
  expect(requestedContent).toBe(newContent);
  expect((await read(page, original.id)).content).toBe(newContent);
});

test("marks old analysis as stale and retains it when regeneration fails", async ({
  page,
}) => {
  const original = await prepare(page);
  let record: Idea = {
    ...original,
    analysis,
    status: "completed",
    analysisModel: "test-model",
    analyzedAt: new Date().toISOString(),
  };
  await page.route("**/api/ideas", (route) =>
    route.fulfill({ json: { ideas: [record] } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { configured: true, model: "test-model" } }),
  );
  await page.route(`**/api/ideas/${original.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    // Save real text but simulate a pre-existing analysis in the browser only.
    const response = await route.fetch();
    record = { ...(await response.json()).idea, analysis, analysisStale: true };
    await route.fulfill({ json: { idea: record } });
  });
  await page.route(`**/api/ideas/${original.id}/analyze`, (route) => {
    record = {
      ...record,
      status: "failed",
      error: "模拟分析服务暂时不可用",
      updatedAt: new Date().toISOString(),
    };
    return route.fulfill({ status: 502, json: { error: record.error } });
  });
  await page.reload();
  await expect(page.locator("h1")).toHaveText(analysis.title);
  await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
  await editor(page).getByLabel("修改灵感内容").fill(newContent);
  await editor(page)
    .getByRole("button", { name: "保存修改", exact: true })
    .click();
  await expect(page.locator(".analysis-stale")).toContainText("修改前的分析");
  await expect(page.locator("h1")).toHaveText(newContent.split("\n")[0]);
  await expect(page.locator(".detail-meta .status")).toHaveText("分析待更新");
  await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await expect(page.locator(".analysis-panel .form-error")).toContainText(
    "上一次成功的分析已保留",
  );
  await expect(page.locator(".analysis-summary")).toContainText(
    analysis.summary,
  );
  await expect(page.locator(".original-text")).toHaveText(newContent);
  await page.getByRole("button", { name: "返回灵感轨迹" }).click();
  await expect(page.locator(".idea-card h3")).toContainText(
    newContent.split("\n")[0],
  );
  await expect(page.locator(".idea-insight")).toHaveCount(0);
});

test("a delayed previous analysis cannot overwrite an edit or prevent its new analysis", async ({
  page,
}) => {
  const original = await prepare(page);
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { configured: true, model: "test-model" } }),
  );
  await page.reload();
  let captured!: () => void;
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/ideas/${original.id}/analyze`, async (route) => {
    const revision = route.request().postDataJSON().revision;
    if (revision === original.revision) {
      captured();
      await gate;
      return route.fulfill({
        json: {
          idea: {
            ...original,
            analysis: { ...analysis, title: "过期的分析" },
            status: "completed",
            updatedAt: new Date().toISOString(),
          },
        },
      });
    }
    const saved = await read(page, original.id);
    return route.fulfill({
      json: {
        idea: {
          ...saved,
          analysis,
          status: "completed",
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });
  try {
    await page.getByRole("button", { name: "分析这条灵感" }).click();
    await started;
    await page.getByRole("button", { name: "编辑灵感", exact: true }).click();
    await editor(page).getByLabel("修改灵感内容").fill(newContent);
    await editor(page).getByRole("button", { name: "保存并重新分析" }).click();
    await expect(page.locator("h1")).toHaveText(analysis.title);
    const delayed = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/ideas/${original.id}/analyze`) &&
        r.request().postDataJSON().revision === original.revision,
    );
    release();
    await (await delayed).finished();
    await expect(page.locator("h1")).toHaveText(analysis.title);
    await expect(page.locator(".original-text")).toHaveText(newContent);
  } finally {
    release();
  }
});

test.describe("mobile editing", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("offers touch-friendly editing and a dialog that fits the screen", async ({
    page,
  }) => {
    const original = await prepare(page);
    await page.getByRole("button", { name: "返回灵感轨迹" }).click();
    await page.getByLabel("搜索灵感或关键词").fill(prefix);
    const edit = page
      .locator(".idea-card")
      .filter({ hasText: prefix })
      .getByRole("button", { name: "编辑灵感", exact: true });
    expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await edit.click();
    await editor(page).getByLabel("修改灵感内容").fill(newContent);
    expect(
      await editor(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth,
      ),
    ).toBe(true);
    await editor(page).screenshot({
      path: "test-results/idea-editor-mobile.png",
    });
    await editor(page)
      .getByRole("button", { name: "保存修改", exact: true })
      .click();
    await expect(editor(page)).toHaveCount(0);
    expect((await read(page, original.id)).content).toBe(newContent);
  });
});
