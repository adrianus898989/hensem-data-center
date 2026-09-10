/* Local UI fixture only: no real sessions, accounts, or external writes. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const baseUrl = process.env.UI_TEST_URL || "http://localhost:3100";
assert(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname), "UI test may only target localhost");
const mockOrigin = "https://ui-test.supabase.co";
const fullPermissions = { home: true, third_party: true, auto_withdraw: true, work_orders: true, customer_service: true };
const thirdPartyOnly = { home: true, third_party: true, auto_withdraw: false, work_orders: false, customer_service: false };
const management = { manage_viewers: true, refresh_data: true, view_audit: true };
const names = ["admin", "finance01", "ops01", "xiaofeng", "report01", "service01", "team02", "viewer03", "archive01"];
const users = names.map((username, i) => ({
  auth_user_id: `fixture-user-${i}`,
  username,
  role: i === 0 ? "owner" : i < 4 ? "admin" : "viewer",
  active: i !== 8,
  permissions: i === 0 || i === 2 ? { ...fullPermissions } : { ...thirdPartyOnly },
  management_permissions: i < 4 ? { ...management } : { manage_viewers: false, refresh_data: false, view_audit: false },
}));
const mockSession = {
  access_token: "local-ui-fixture-token",
  refresh_token: "local-ui-fixture-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: users[0].auth_user_id, email: "fixture@hensem.local" },
};

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1728, height: 1080 }, locale: "zh-CN", serviceWorkers: "block" });
  const requests = [];
  const rejectedOrigins = [];
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(({ session }) => {
    localStorage.setItem("hensem:dashboard:auth-session:v2", JSON.stringify(session));
    localStorage.setItem("hensem.dashboard.last_activity", String(Date.now()));
  }, { session: mockSession });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = data => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.origin === mockOrigin) {
      if (url.pathname === "/rest/v1/dashboard_profiles") return json([users[0]]);
      if (url.pathname === "/auth/v1/token") return json(mockSession);
      if (url.pathname === "/functions/v1/dashboard-user-admin") {
        const body = request.postDataJSON();
        requests.push(body);
        if (body.action === "check-access") return json({ ok: true });
        if (body.action === "list-users") return json({ users });
        if (body.action === "list-audit") return json({ logs: [] });
        if (body.action === "ip-settings") return json({ enabled: false, currentIp: "192.0.2.10", rows: [] });
        if (["history-status", "auto-withdraw-history-status"].includes(body.action)) return json({ history: null });
        if (body.action === "update-account") {
          const user = users.find(item => item.username === body.username);
          assert(user && user.role !== "owner", "Owner must remain protected");
          for (const field of ["permissions", "management_permissions", "active"]) {
            if (field in body) user[field] = body[field];
          }
          return json({ ok: true });
        }
        throw new Error(`Unexpected fixture action: ${body.action}`);
      }
      throw new Error(`Unexpected fixture URL: ${url.pathname}`);
    }
    if (url.origin === new URL(baseUrl).origin) {
      if (url.pathname.startsWith("/api/")) return json({ dailyRows: [], operatorRows: [], source: "local-ui-fixture" });
      return route.continue();
    }
    rejectedOrigins.push(url.origin);
    return route.abort("blockedbyclient");
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /管理后台/ }).waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: /管理后台/ }).click();
    await page.getByRole("button", { name: /账号与权限/ }).click();
    await page.locator(".admin-account-table tbody tr").first().waitFor();
    assert.equal(await page.locator(".admin-account-table tbody tr").count(), 9);
    assert.equal(await page.locator(".admin-account-editor").count(), 0);
    assert.equal(await page.locator("#admin-create-account").count(), 0);
    assert.equal(await page.locator(".admin-access-details").getAttribute("open"), null);
    assert.equal(await page.locator(".admin-account-table tbody tr").first().getByRole("button").count(), 0);
    const heights = await page.locator(".admin-account-table tbody tr").evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
    assert(heights.every(height => height <= 65), `Rows must remain compact: ${heights}`);
    fs.mkdirSync(path.join(process.cwd(), "outputs"), { recursive: true });
    await page.locator(".admin-account-directory-head p").evaluate(el => { el.textContent = "示例账号 · 本地演示。点击设置即可调整权限。"; });
    await page.screenshot({ path: "outputs/admin-compact.png", fullPage: true });

    const financeRow = page.locator(".admin-account-table tbody tr").filter({ has: page.getByText("finance01", { exact: true }) });
    await financeRow.getByRole("button", { name: /设置/ }).click();
    assert.equal(await page.locator(".admin-account-editor").count(), 1);
    assert.equal(await page.locator(".admin-account-editor input[type=checkbox]").count(), 6);
    await page.screenshot({ path: "outputs/admin-settings.png", fullPage: true });
    await page.locator(".admin-account-editor").getByRole("button", { name: "重置密码" }).click();
    await page.getByPlaceholder("输入新的临时密码（至少 8 位）").waitFor();
    await page.locator(".admin-inline-reset").getByRole("button", { name: "取消" }).click();
    let deleteConfirmation = "";
    page.once("dialog", async dialog => { deleteConfirmation = dialog.message(); await dialog.dismiss(); });
    await page.locator(".admin-account-editor").getByRole("button", { name: "删除账号" }).click();
    assert(deleteConfirmation.includes("finance01"), "Deleting still requires account-specific confirmation");
    assert(!requests.some(request => request.action === "delete-account"));

    const opsRow = page.locator(".admin-account-table tbody tr").filter({ has: page.getByText("ops01", { exact: true }) });
    await opsRow.getByRole("button", { name: /设置/ }).click();
    assert.equal(await page.locator(".admin-account-editor").count(), 1, "Only one account editor opens at once");
    await page.locator(".admin-account-editor").getByLabel("三方量 / 费率", { exact: true }).click();
    await page.getByText("ops01 已更新。", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector(".admin-account-editor input[type=checkbox]")?.checked === false);
    const update = requests.find(request => request.action === "update-account");
    assert.equal(update.username, "ops01");
    assert.equal(update.permissions.third_party, false);
    assert.equal(update.permissions.auto_withdraw, true, "Other permissions must be preserved");
    await opsRow.getByRole("button", { name: /收起/ }).click();

    await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
    const createPanel = page.locator("#admin-create-account");
    const viewerChecked = await createPanel.locator("input[type=checkbox]").evaluateAll(inputs => inputs.map(input => input.checked));
    assert.deepEqual(viewerChecked, [true, false, false], "Viewer defaults must remain unchanged");
    await createPanel.getByRole("button", { name: /小管理员/ }).click();
    const adminChecked = await createPanel.locator("input[type=checkbox]").evaluateAll(inputs => inputs.map(input => input.checked));
    assert.deepEqual(adminChecked, [true, true, true, true, true, true], "Admin defaults must remain unchanged");
    await createPanel.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await page.locator("#admin-create-account").count(), 0);

    await page.getByPlaceholder("输入账号、角色、模块或后台权限").fill("finance01");
    assert.equal(await page.locator(".admin-account-table tbody tr").count(), 1);
    await page.getByPlaceholder("输入账号、角色、模块或后台权限").fill("");
    assert.equal(await page.locator(".admin-account-table tbody tr").count(), 9);

    const responsive = [];
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const createButton = page.getByRole("button", { name: "+ 新建账号", exact: true });
      await createButton.scrollIntoViewIfNeeded();
      const docSize = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert(docSize.scrollWidth <= docSize.width + 1, `Document overflow at ${viewport.width}: ${JSON.stringify(docSize)}`);
      const unobscured = await createButton.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !!top && (top === button || button.contains(top));
      });
      assert(unobscured, `New-account button is obscured at ${viewport.width}`);
      await page.locator(".admin-account-table-wrap").evaluate(wrap => { wrap.scrollLeft = wrap.scrollWidth; });
      const settings = financeRow.getByRole("button", { name: /设置/ });
      await settings.scrollIntoViewIfNeeded();
      const settingsRect = await settings.boundingBox();
      assert(settingsRect && settingsRect.x >= 0 && settingsRect.x + settingsRect.width <= viewport.width + 1, `Settings inaccessible at ${viewport.width}`);
      await settings.click();
      assert.equal(await page.locator(".admin-account-editor").count(), 1);
      await financeRow.getByRole("button", { name: /收起/ }).click();
      const finalDocSize = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert(finalDocSize.scrollWidth <= finalDocSize.width + 1, `Document overflow after editing at ${viewport.width}`);
      responsive.push({ ...viewport, horizontalOverflow: false, settingsAccessible: true, newAccountUnobscured: true });
    }
    assert.deepEqual(errors, [], "No page runtime errors");
    assert.deepEqual(rejectedOrigins, [], "No unexpected external traffic");
    console.log(JSON.stringify({ result: "passed", accounts: 9, maxRowHeight: Math.max(...heights), screenshots: ["outputs/admin-compact.png", "outputs/admin-settings.png"], checks: ["compact rows", "owner protected", "single settings panel", "reset cancellation", "delete confirmation", "permission autosave", "creation defaults", "search"], responsive }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
