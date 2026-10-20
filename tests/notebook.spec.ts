import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const prefix = `[自动化测试 ${Date.now()}]`;
const draftText = `${prefix} 是否可以用少量标注提升实验图像识别效果？\n先比较主动学习和随机采样，再验证标注成本。`;

async function openHome(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  await expect(page.locator(".loading-block")).toHaveCount(0);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const response = await page.request.get("/api/ideas");
  if (!response.ok()) return;
  const { ideas } = await response.json();
  for (const idea of ideas.filter((item: { content: string }) =>
    item.content.startsWith(prefix),
  ))
    await page.request.delete(`/api/ideas/${idea.id}`);
});

test("captures, timestamps, persists, opens details, bookmarks, searches and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openHome(page);
  await expect(page.getByRole("button", { name: "保存灵感" })).toBeDisabled();
  await page.getByLabel("写下你的科研灵感").fill(draftText);
  await page.getByLabel("灵感关键词，用逗号分隔").fill("主动学习，图像识别");
  await page.getByRole("button", { name: "保存灵感" }).click();
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).not.toBeVisible();
  const card = page.locator(".idea-card").filter({ hasText: prefix });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("待分析", { exact: true })).toBeVisible();
  const { ideas } = await (await page.request.get("/api/ideas")).json();
  const record = ideas.find(
    (idea: { content: string }) => idea.content === draftText,
  );
  expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(record.tags).toEqual(["主动学习", "图像识别"]);
  await card.locator(".idea-card-main").click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${record.id}$`));
  await expect(page.locator(".original-text")).toHaveText(draftText);
  await expect(
    page.getByText("你的灵感已经妥善保存。", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".original-text")).toHaveText(draftText);
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "收藏灵感", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回灵感轨迹" }).click();
  await page.getByRole("button", { name: /^我的收藏/ }).click();
  await expect(
    page.locator(".idea-card").filter({ hasText: prefix }),
  ).toHaveCount(1);
  await page.getByLabel("搜索灵感或关键词").fill("不存在的关键词xyz");
  await expect(page.locator(".idea-card")).toHaveCount(0);
  await page.getByLabel("搜索灵感或关键词").fill("主动学习");
  await expect(
    page.locator(".idea-card").filter({ hasText: prefix }),
  ).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部灵感" }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(
    exported.ideas.some((idea: { id: string }) => idea.id === record.id),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/timeline-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("preserves the draft across save failure and reload; retries without duplicate records", async ({
  page,
}) => {
  await openHome(page);
  await page
    .getByLabel("写下你的科研灵感")
    .fill(`${prefix} 网络失败时也不能丢掉这个想法`);
  await page.route("**/api/ideas", (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.getByRole("button", { name: "保存灵感" }).click();
  await expect(page.locator(".form-error")).toContainText("网络暂时不可用");
  await page.reload();
  await expect(page.getByLabel("写下你的科研灵感")).toHaveValue(
    `${prefix} 网络失败时也不能丢掉这个想法`,
  );
  await page.unroute("**/api/ideas");
  await page.getByLabel("写下你的科研灵感").press("Control+Enter");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).not.toBeVisible();
  await expect(
    page.locator(".idea-card").filter({ hasText: prefix }),
  ).toHaveCount(1);
});

test("preserves edits when a save succeeded but its confirmation was lost", async ({
  page,
}) => {
  await openHome(page);
  const original = `${prefix} 已保存但确认丢失的原文`;
  const edited = `${prefix} 确认丢失后继续补充的新想法`;
  await page.getByLabel("写下你的科研灵感").fill(original);
  await page.route("**/api/ideas", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "保存灵感" }).click();
  await expect(page.locator(".form-error")).toContainText("网络暂时不可用");
  await page.unroute("**/api/ideas");
  await page.getByLabel("写下你的科研灵感").fill(edited);
  await page.getByRole("button", { name: "保存灵感" }).click();
  await expect(page.locator(".form-error")).toContainText("较早版本已保存");
  await expect(page.getByLabel("写下你的科研灵感")).toHaveValue(edited);
  await page.getByRole("button", { name: "保存灵感" }).click();
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).not.toBeVisible();
  const { ideas } = await (await page.request.get("/api/ideas")).json();
  expect(
    ideas.filter((idea: { content: string }) =>
      [original, edited].includes(idea.content),
    ),
  ).toHaveLength(2);
});

test("validates API input, protects writes, and keeps the record when no AI is configured", async ({
  page,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  expect((await anonymous.get("/api/ideas")).status()).toBe(401);
  await anonymous.dispose();
  await openHome(page);
  const id = crypto.randomUUID();
  expect(
    (
      await page.request.post("/api/ideas", { data: { id, content: "   " } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/ideas", {
        headers: { Origin: "https://unrelated.invalid" },
        data: { id, content: "不应保存" },
      })
    ).status(),
  ).toBe(403);
  const payload = { id, content: `${prefix} 无 AI 配置时的原始内容`, tags: [] };
  const first = await page.request.post("/api/ideas", { data: payload });
  expect(first.status()).toBe(201);
  const second = await page.request.post("/api/ideas", { data: payload });
  expect((await second.json()).idea.createdAt).toBe(
    (await first.json()).idea.createdAt,
  );
  expect((await page.request.post(`/api/ideas/${id}/analyze`)).status()).toBe(
    503,
  );
  const saved = (await (await page.request.get(`/api/ideas/${id}`)).json())
    .idea;
  expect(saved.content).toBe(payload.content);
  expect(saved.status).toBe("pending");
  const config = await (await page.request.get("/api/config")).json();
  expect(config.configured).toBe(false);
  expect(config).not.toHaveProperty("key");
  expect(config).not.toHaveProperty("AI_API_KEY");
});

test("requires delete confirmation and handles missing detail URLs", async ({
  page,
}) => {
  await openHome(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/ideas", {
    data: { id, content: `${prefix} 删除流程`, tags: [] },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "删除灵感", exact: true }).click();
  await page.getByRole("button", { name: "保留灵感" }).click();
  await expect(page.locator(".original-text")).toContainText("删除流程");
  await page.getByRole("button", { name: "删除灵感", exact: true }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  expect((await page.request.get(`/api/ideas/${id}`)).status()).toBe(404);
  await page.goto(`/ideas/${id}`);
  await expect(page.getByText("这条灵感暂时找不到了")).toBeVisible();
});

test("works on mobile, keeps keyboard focus in the dialog and fits the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await expect(page.getByLabel("写下你的科研灵感")).toBeFocused();
  await page.screenshot({
    path: "test-results/composer-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "记录灵感", exact: true }).click();
  await page.getByLabel("写下你的科研灵感").fill(`${prefix} 手机端记录`);
  await page.getByRole("button", { name: "保存灵感" }).click();
  const card = page.locator(".idea-card").filter({ hasText: "手机端记录" });
  await expect(card).toHaveCount(1);
  await card.locator(".idea-card-main").click();
  await expect(page.locator(".original-text")).toContainText("手机端记录");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/detail-mobile.png",
    fullPage: true,
  });
});

test("renders structured AI analysis and a retry failure while preserving previous results", async ({
  page,
}) => {
  const record = {
    id: crypto.randomUUID(),
    title: "自动化测试：探索主动学习",
    content: "这是浏览器测试专用数据，不保存到数据库。",
    tags: ["主动学习"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    analysisStale: false,
    bookmarked: false,
    status: "completed",
    analysis: {
      title: "主动学习能否降低科研图像的标注成本？",
      summary: "通过挑选信息量较高的样本，探索减少人工标注的可能性。",
      question: "相同标注预算下，主动学习是否优于随机采样？",
      value: "有望提高数据利用率，需要通过实验验证。",
      approach: "固定模型与预算，对比不同采样策略，注意数据泄漏与样本偏差。",
      nextSteps: [
        "确定数据集与评估指标",
        "构建随机采样基线",
        "进行小规模对照实验",
      ],
      keywords: ["主动学习", "图像识别"],
    },
    analysisModel: "browser-test-model",
    analyzedAt: new Date().toISOString(),
    analysisStartedAt: null,
    error: null as string | null,
  };
  await page.route("**/api/ideas", (route) =>
    route.fulfill({ json: { ideas: [record] } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        configured: true,
        model: "browser-test-model",
        displayName: "Test",
      },
    }),
  );
  await page.route(`**/api/ideas/${record.id}/analyze`, async (route) => {
    record.status = "failed";
    record.error = "模拟的 AI 暂时不可用";
    await route.fulfill({ status: 502, json: { error: record.error } });
  });
  await page.goto(`/ideas/${record.id}`);
  await expect(
    page.getByRole("heading", { name: "核心研究问题" }),
  ).toBeVisible();
  await expect(page.locator(".next-step")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/analysis-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "重新分析" }).click();
  await expect(page.locator(".analysis-panel .form-error")).toContainText(
    "上一次成功的分析已保留",
  );
  await expect(
    page.getByRole("heading", { name: "核心研究问题" }),
  ).toBeVisible();
  await expect(page.locator(".original-text")).toHaveText(record.content);
});
