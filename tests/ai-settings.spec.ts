import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const fakeKey = "sk-browser-test-only-00001234";

async function openSettings(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "捕捉一束灵感" }),
  ).toBeVisible();
  await expect(page.locator(".loading-block")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开 AI 设置" }).click();
  await expect(
    page.getByRole("dialog", { name: "AI 连接", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "保存连接" })).toBeEnabled();
}

test("saves a DeepSeek connection, masks its key, reloads, changes models without re-entering the key and removes it", async ({
  page,
}) => {
  await openSettings(page);
  const existing = await (await page.request.get("/api/config")).json();
  test.skip(
    existing.configured,
    "Never replace an existing user's credentials during a test.",
  );
  let wroteConnection = false;
  try {
    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(page.getByRole("alert")).toContainText("请先填写");
    await page.getByLabel("API Key", { exact: true }).fill(fakeKey);
    await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    await page.getByRole("button", { name: "显示密钥" }).click();
    await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await page.getByRole("button", { name: "隐藏密钥" }).click();
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/config") && res.request().method() === "POST",
    );
    // Cleanup is armed before the request; a lost response may still have persisted.
    wroteConnection = true;
    await page.getByRole("button", { name: "保存连接" }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toContain(fakeKey);
    expect(response.headers()["cache-control"]).toBe("no-store");
    await expect(page.getByRole("status")).toContainText("连接已保存");
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
    await expect(page.locator("#connection-key-hint")).toContainText("1234");
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain(fakeKey);
    await page.reload();
    await expect(
      page.getByRole("dialog", { name: "捕捉一束灵感" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "AI 连接设置" }).click();
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("分析模型")).toHaveValue("deepseek-flash");
    await page.getByLabel("分析模型").selectOption("deepseek-v4-pro");
    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(page.getByRole("status")).toContainText("连接已保存");
    const config = await (await page.request.get("/api/config")).json();
    expect(config.model).toBe("deepseek-v4-pro");
    expect(config.keyHint).toBe("1234");
    expect(Object.keys(config).sort()).toEqual([
      "configured",
      "displayName",
      "keyHint",
      "model",
      "provider",
      "source",
    ]);
    await page.getByRole("button", { name: "移除连接", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      (await (await page.request.get("/api/config")).json()).configured,
    ).toBe(true);
    await page.getByRole("button", { name: "移除连接", exact: true }).click();
    await page.getByRole("button", { name: "确认移除" }).click();
    await expect(page.getByRole("status")).toContainText("已移除连接");
    expect(
      (await (await page.request.get("/api/config")).json()).configured,
    ).toBe(false);
  } finally {
    if (wroteConnection) await page.request.delete("/api/config");
  }
});

test("tests draft credentials with honest success and failure feedback, and keeps unsaved keys out of storage", async ({
  page,
}) => {
  // Model provider responses are mocked; no real credentials or paid calls.
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        configured: false,
        model: null,
        displayName: "测试",
        provider: null,
        source: null,
        keyHint: null,
      },
    }),
  );
  await openSettings(page);
  await page.getByLabel("API Key", { exact: true }).fill(fakeKey);
  await page.getByLabel("分析模型").selectOption("custom");
  await page.getByLabel("自定义模型名称").fill("deepseek-test-model");
  let succeed = false;
  await page.route("**/api/config/test", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: "deepseek",
      model: "deepseek-test-model",
      apiKey: fakeKey,
    });
    await route.fulfill(
      succeed
        ? {
            json: {
              ok: true,
              message: "密钥验证通过，所选模型可用。实际分析仍取决于账户额度。",
            },
          }
        : {
            status: 422,
            json: {
              error: "DeepSeek 验证失败，请检查 API Key 是否正确或已失效。",
            },
          },
    );
  });
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("alert")).toContainText("验证失败");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue(
    fakeKey,
  );
  succeed = true;
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("status")).toContainText("请保存连接");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(fakeKey);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "AI 连接设置" }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.unrouteAll({ behavior: "wait" });
});

test("settings APIs require login, reject foreign origins and validate credentials without modifying current settings", async ({
  page,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  try {
    for (const endpoint of ["/api/config", "/api/config/test"])
      expect((await anonymous.post(endpoint, { data: {} })).status()).toBe(401);
    expect((await anonymous.get("/api/config")).status()).toBe(401);
    expect((await anonymous.delete("/api/config")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  await openSettings(page);
  const initial = await (await page.request.get("/api/config")).json();
  for (const endpoint of ["/api/config", "/api/config/test"]) {
    expect(
      (
        await page.request.post(endpoint, {
          headers: { Origin: "https://unrelated.invalid" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(endpoint, {
          data: { provider: "deepseek", model: "", apiKey: fakeKey },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post(endpoint, {
          data: {
            provider: "deepseek",
            model: "deepseek-flash",
            apiKey: fakeKey,
            baseURL: "https://unrelated.invalid",
          },
        })
      ).status(),
    ).toBe(400);
  }
  expect(
    (
      await page.request.delete("/api/config", {
        headers: { Origin: "https://unrelated.invalid" },
      })
    ).status(),
  ).toBe(403);
  expect(await (await page.request.get("/api/config")).json()).toEqual(initial);
});

test("settings fit mobile and expose keyboard-accessible fields", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "AI 连接", exact: true });
  await page.getByLabel("API Key", { exact: true }).focus();
  await expect(page.getByLabel("API Key", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "显示密钥" })).toBeFocused();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/ai-settings-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/ai-settings-desktop.png",
    fullPage: true,
  });
});
