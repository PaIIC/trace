import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Idea, IdeaHistory } from "../lib/domain";

const prefix = `[历史测试 ${Date.now()}]`;
const createdIds = new Set<string>();
const historyDialog = (page: Page) =>
  page.getByRole("dialog", { name: "灵感历史版本" });
const analysis = {
  title: "第一版的研究问题",
  summary: "这是第一版想法对应的分析。",
  question: "哪些条件影响实验结果？",
  value: "寻找可以验证的因果关系。",
  approach: "建立对照组并记录测量结果。",
  nextSteps: ["列出控制变量", "进行预实验"],
  keywords: ["因果关系"],
};

async function prepare(page: Page, edits = 2): Promise<Idea> {
  await page.route("**/api/ideas/*/analyze", (route) =>
    route.fulfill({ status: 503, json: { error: "测试禁止真实模型调用" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  const id = crypto.randomUUID();
  createdIds.add(id);
  const created = await page.request.post("/api/ideas", {
    data: {
      id,
      content: `${prefix} 第一版想法\n记录初始假设。`,
      tags: ["初稿"],
    },
  });
  expect(created.status()).toBe(201);
  const original: Idea = (await created.json()).idea;
  for (let index = 0; index < edits; index++) {
    const response = await page.request.patch(`/api/ideas/${id}`, {
      data: {
        revision: index + 1,
        content: `${prefix} 第 ${index + 2} 版想法`,
        tags: [`版本${index + 2}`],
      },
    });
    expect(response.status()).toBe(200);
  }
  await page.goto(`/ideas/${id}`);
  await expect(
    page.getByRole("button", { name: "历史版本", exact: true }),
  ).toBeVisible();
  return original;
}

async function history(page: Page, id: string): Promise<IdeaHistory> {
  const response = await page.request.get(`/api/ideas/${id}/history`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function chooseFirst(page: Page) {
  await historyDialog(page)
    .getByRole("button", { name: "第 1 版", exact: true })
    .click();
  await historyDialog(page).getByRole("button", { name: "恢复此版本" }).click();
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  for (const id of createdIds) await page.request.delete(`/api/ideas/${id}`);
  createdIds.clear();
});

test("previews immutable versions, confirms restore, preserves the replaced version and exports history", async ({
  page,
}) => {
  const original = await prepare(page);
  await page.getByRole("button", { name: "收藏灵感", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  const dialog = historyDialog(page);
  await expect(
    dialog.getByRole("button", { name: "第 3 版，当前版本", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByRole("button", { name: "恢复此版本" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "第 1 版", exact: true }).click();
  await expect(dialog.locator(".history-content > p")).toHaveText(
    original.content,
  );
  await expect(dialog.locator(".history-content .tags")).toContainText("初稿");
  await expect(dialog.locator(".history-analysis")).toContainText(
    "保存时尚无 AI 分析",
  );
  await dialog.getByRole("button", { name: "恢复此版本" }).click();
  await expect(
    dialog.getByRole("group", { name: "确认恢复历史版本" }),
  ).toContainText("当前第 3 版会保留");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect((await history(page, original.id)).idea.revision).toBe(3);
  await dialog.getByRole("button", { name: "恢复此版本" }).click();
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".original-text")).toHaveText(original.content);
  await expect(page.locator(".detail-meta time")).toHaveAttribute(
    "datetime",
    original.createdAt,
  );
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeVisible();
  await page.reload();
  const restored = await history(page, original.id);
  expect(restored.idea.revision).toBe(4);
  expect(restored.idea.restoredFromRevision).toBe(1);
  expect(restored.idea.bookmarked).toBe(true);
  expect(restored.versions.map((v) => v.idea.revision)).toEqual([3, 2, 1]);
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await dialog.getByRole("button", { name: "第 3 版", exact: true }).click();
  await expect(dialog.locator(".history-content > p")).toHaveText(
    `${prefix} 第 3 版想法`,
  );
  await dialog.screenshot({ path: "test-results/idea-history-desktop.png" });
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部灵感" }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.version).toBe(2);
  expect(
    exported.history.filter(
      (version: { idea: Idea }) => version.idea.id === original.id,
    ),
  ).toHaveLength(3);
  expect(
    exported.ideas.find((idea: Idea) => idea.id === original.id).revision,
  ).toBe(4);
  expect(JSON.stringify(exported)).not.toMatch(
    /encryptedKey|apiKey|analysis_job|restore_request_id/,
  );
});

test("keeps failed restores retryable and deduplicates a retry after the success response was lost", async ({
  page,
}) => {
  const original = await prepare(page, 1);
  let commit = false;
  await page.route(`**/api/ideas/${original.id}/restore`, async (route) => {
    if (commit) await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await chooseFirst(page);
  const dialog = historyDialog(page);
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络暂时不可用");
  expect((await history(page, original.id)).idea.revision).toBe(2);
  await expect(dialog.locator(".history-content > p")).toHaveText(
    original.content,
  );
  commit = true;
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect
    .poll(async () => (await history(page, original.id)).idea.revision)
    .toBe(3);
  await expect(dialog.getByRole("alert")).toContainText("网络暂时不可用");
  await page.unroute(`**/api/ideas/${original.id}/restore`);
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await history(page, original.id);
  expect(saved.idea.revision).toBe(3);
  expect(saved.versions).toHaveLength(2);
});

test("does not overwrite a newer edit when restoring from an out-of-date dialog", async ({
  page,
}) => {
  const original = await prepare(page, 1);
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await chooseFirst(page);
  const update = await page.request.patch(`/api/ideas/${original.id}`, {
    data: {
      revision: 2,
      content: `${prefix} 另一个页面的新想法`,
      tags: ["新"],
    },
  });
  expect(update.status()).toBe(200);
  const dialog = historyDialog(page);
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("当前灵感已更新");
  expect((await history(page, original.id)).idea.content).toContain(
    "另一个页面的新想法",
  );
  await dialog.getByRole("button", { name: "刷新历史记录" }).click();
  await expect(dialog.locator(".history-content > p")).toContainText(
    "另一个页面的新想法",
  );
  await chooseFirst(page);
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await history(page, original.id)).versions[0].idea.content).toContain(
    "另一个页面的新想法",
  );
});

test("API validates restore requests, serializes competing restores and deletes only that idea's history", async ({
  page,
}) => {
  const original = await prepare(page);
  const data = {
    revision: 3,
    versionRevision: 1,
    requestId: crypto.randomUUID(),
  };
  for (const invalid of [
    { ...data, versionRevision: 0 },
    { ...data, revision: 0 },
    { ...data, requestId: "invalid" },
    { ...data, content: "伪造历史" },
    { ...data, analysis },
  ]) {
    expect(
      (
        await page.request.post(`/api/ideas/${original.id}/restore`, {
          data: invalid,
        })
      ).status(),
    ).toBe(400);
  }
  expect(
    (
      await page.request.post(`/api/ideas/${original.id}/restore`, {
        data,
        headers: { Origin: "https://invalid.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(`/api/ideas/${original.id}/restore`, {
        data: { ...data, versionRevision: 99 },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(`/api/ideas/${crypto.randomUUID()}/history`)
    ).status(),
  ).toBe(404);
  const requests = [
    data,
    { ...data, versionRevision: 2, requestId: crypto.randomUUID() },
  ];
  const responses = await Promise.all(
    requests.map((body) =>
      page.request.post(`/api/ideas/${original.id}/restore`, { data: body }),
    ),
  );
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  const saved = await history(page, original.id);
  expect(saved.idea.revision).toBe(4);
  expect(saved.versions).toHaveLength(3);
  const unrelated = await prepare(page, 1);
  expect(
    (await page.request.delete(`/api/ideas/${original.id}`)).status(),
  ).toBe(200);
  expect(
    (await page.request.get(`/api/ideas/${original.id}/history`)).status(),
  ).toBe(404);
  const exported = await (await page.request.get("/api/ideas/export")).json();
  expect(
    exported.history.some(
      (version: { idea: Idea }) => version.idea.id === original.id,
    ),
  ).toBe(false);
  expect((await history(page, unrelated.id)).versions).toHaveLength(1);
});

test("displays full version-specific analysis, distinguishes stale analysis and restores the matching output", async ({
  page,
}) => {
  const original = await prepare(page);
  const stored = await history(page, original.id);
  const first = {
    ...original,
    status: "completed" as const,
    analysis,
    analysisModel: "history-test-model",
    analyzedAt: original.createdAt,
  };
  const records: IdeaHistory = {
    ...stored,
    versions: [
      {
        ...stored.versions[0],
        idea: { ...stored.versions[0].idea, analysis, analysisStale: true },
      },
      { ...stored.versions[1], idea: first },
    ],
  };
  await page.route(`**/api/ideas/${original.id}/history`, (route) =>
    route.fulfill({ json: records }),
  );
  await page.route(`**/api/ideas/${original.id}/restore`, async (route) => {
    // Keep all real writes in the normal API; attach a simulated AI snapshot
    // only in the browser response. No provider is contacted by this test.
    const response = await route.fetch();
    const saved = (await response.json()).idea;
    await route.fulfill({
      json: {
        idea: {
          ...saved,
          analysis,
          analysisStale: false,
          status: "completed",
          analysisModel: first.analysisModel,
          analyzedAt: first.analyzedAt,
        },
      },
    });
  });
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  const dialog = historyDialog(page);
  await dialog.getByRole("button", { name: "第 2 版", exact: true }).click();
  await expect(dialog.locator(".history-analysis")).toContainText(
    "早于该版本的修改",
  );
  await dialog.getByRole("button", { name: "第 1 版", exact: true }).click();
  await expect(dialog.locator(".history-analysis h4").first()).toHaveText(
    "对应 AI 分析",
  );
  for (const text of [
    analysis.summary,
    analysis.question,
    analysis.value,
    analysis.approach,
    ...analysis.nextSteps,
    ...analysis.keywords,
    first.analysisModel,
  ]) {
    await expect(dialog.locator(".history-analysis")).toContainText(text);
  }
  await dialog.getByRole("button", { name: "恢复此版本" }).click();
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".original-text")).toHaveText(original.content);
  await expect(page.locator(".analysis-summary")).toContainText(
    analysis.summary,
  );
  await expect(page.locator("h1")).toHaveText(analysis.title);
});

test("retries history loading and offers empty history from both timeline and bookmarks", async ({
  page,
}) => {
  const original = await prepare(page, 0);
  await page.getByRole("button", { name: "收藏灵感", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "返回灵感轨迹" }).click();
  const card = page.locator(".idea-card").filter({ hasText: original.content });
  await page.route(`**/api/ideas/${original.id}/history`, (route) =>
    route.abort("failed"),
  );
  await card.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(historyDialog(page).getByRole("alert")).toContainText(
    "网络暂时不可用",
  );
  await page.unroute(`**/api/ideas/${original.id}/history`);
  await historyDialog(page).getByRole("button", { name: "重新加载" }).click();
  await expect(historyDialog(page).locator(".history-empty")).toContainText(
    "还没有历史版本",
  );
  await historyDialog(page).getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("button", { name: /^我的收藏/ }).click();
  await card.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(
    historyDialog(page).getByRole("button", { name: "恢复此版本" }),
  ).toBeDisabled();
});

test.describe("mobile history", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("browses versions and restores without horizontal page overflow", async ({
    page,
  }) => {
    const original = await prepare(page);
    await page.getByRole("button", { name: "历史版本", exact: true }).click();
    const dialog = historyDialog(page);
    await dialog.getByRole("button", { name: "第 1 版", exact: true }).click();
    await expect(dialog.locator(".history-content > p")).toHaveText(
      original.content,
    );
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await dialog.screenshot({ path: "test-results/idea-history-mobile.png" });
    await dialog.getByRole("button", { name: "恢复此版本" }).click();
    await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".original-text")).toHaveText(original.content);
  });
});
