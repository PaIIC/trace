import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const prefix = `[删除测试 ${Date.now()}]`;
const createdIds = new Set<string>();

async function prepare(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  const records = [];
  for (const title of ["要删除的想法", "需要保留的想法"]) {
    const id = crypto.randomUUID();
    createdIds.add(id);
    // API saves do not trigger AI generation, even when the user has a real key.
    const response = await page.request.post("/api/ideas", {
      data: { id, content: `${prefix} ${title}`, tags: [] },
    });
    expect(response.status()).toBe(201);
    records.push((await response.json()).idea);
  }
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  await expect(page.locator(".loading-block")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByLabel("搜索灵感或关键词").fill(prefix);
  return records;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  // Only remove IDs created by this suite; leave real notes and AI settings alone.
  for (const id of createdIds) await page.request.delete(`/api/ideas/${id}`);
  createdIds.clear();
});

test("deletes only the confirmed timeline idea and updates counts after reload", async ({
  page,
}) => {
  const [target, retained] = await prepare(page);
  const total = (await (await page.request.get("/api/ideas")).json()).ideas
    .length;
  const card = page.locator(".idea-card").filter({ hasText: target.content });
  await card.getByRole("button", { name: "删除灵感", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除这条灵感？" });
  await expect(dialog.locator(".delete-target")).toContainText(target.title);
  await expect(dialog.locator("time")).toHaveAttribute(
    "datetime",
    target.createdAt,
  );
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await dialog.getByRole("button", { name: "保留灵感" }).click();
  expect((await page.request.get(`/api/ideas/${target.id}`)).status()).toBe(
    200,
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "删除灵感", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.getByLabel("搜索灵感或关键词")).toHaveValue(prefix);
  await expect(
    page.getByRole("button", { name: /^灵感轨迹/ }).locator(".nav-count"),
  ).toHaveText(String(total - 1));
  expect((await page.request.get(`/api/ideas/${target.id}`)).status()).toBe(
    404,
  );
  expect((await page.request.get(`/api/ideas/${retained.id}`)).status()).toBe(
    200,
  );
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".loading-block")).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

test("deletes from bookmarks while preserving the current view and other ideas", async ({
  page,
}) => {
  const [target, retained] = await prepare(page);
  const card = page.locator(".idea-card").filter({ hasText: target.content });
  await card.getByRole("button", { name: "收藏灵感", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /^我的收藏/ }).click();
  await card.getByRole("button", { name: "删除灵感", exact: true }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^我的收藏/ })).toHaveClass(
    /active/,
  );
  expect((await page.request.get(`/api/ideas/${retained.id}`)).status()).toBe(
    200,
  );
});

test("keeps failed deletions retryable and recovers when the successful response was lost", async ({
  page,
}) => {
  const [target, retained] = await prepare(page);
  let commitBeforeFailure = false;
  await page.route(`**/api/ideas/${target.id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    if (commitBeforeFailure) await route.fetch();
    await route.abort("failed");
  });
  const card = page.locator(".idea-card").filter({ hasText: target.content });
  await card.getByRole("button", { name: "删除灵感", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除这条灵感？" });
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络暂时不可用");
  expect((await page.request.get(`/api/ideas/${target.id}`)).status()).toBe(
    200,
  );
  await expect(card).toHaveCount(1);
  commitBeforeFailure = true;
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络暂时不可用");
  expect((await page.request.get(`/api/ideas/${target.id}`)).status()).toBe(
    404,
  );
  await page.unroute(`**/api/ideas/${target.id}`);
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card).toHaveCount(0);
  expect((await page.request.get(`/api/ideas/${retained.id}`)).status()).toBe(
    200,
  );
});

test("does not restore a deleted idea when an older bookmark response arrives", async ({
  page,
}) => {
  const [target] = await prepare(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const capturedResponse = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(`**/api/ideas/${target.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const result = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response: result });
  });
  try {
    const card = page.locator(".idea-card").filter({ hasText: target.content });
    const bookmarkResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/ideas/${target.id}`) &&
        r.request().method() === "PATCH",
    );
    await card.getByRole("button", { name: "收藏灵感", exact: true }).click();
    await capturedResponse;
    await card.getByRole("button", { name: "删除灵感", exact: true }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(card).toHaveCount(0);
    release();
    await (await bookmarkResponse).finished();
    await page.getByRole("button", { name: /^我的收藏/ }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("灵感已删除");
  } finally {
    release();
  }
});

test.describe("mobile deletion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("has a visible touch target and confirms deletion on mobile", async ({
    page,
  }) => {
    const [target] = await prepare(page);
    const card = page.locator(".idea-card").filter({ hasText: target.content });
    const remove = card.getByRole("button", { name: "删除灵感", exact: true });
    const box = await remove.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "删除这条灵感？" });
    await expect(dialog.locator(".delete-target")).toContainText(target.title);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await dialog.screenshot({
      path: "test-results/delete-confirmation-mobile.png",
    });
    await dialog.getByRole("button", { name: "确认删除" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card).toHaveCount(0);
  });
});
