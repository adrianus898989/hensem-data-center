/* Local-only UI regression. Run with NODE_PATH pointing to a runtime containing playwright.
   All Supabase and data API traffic is mocked; nothing is written to a real project. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const origin = process.env.UI_TEST_ORIGIN || "http://127.0.0.1:3100";
const output = path.resolve(__dirname, "../outputs");
const key = (note) => `${note.data_date}|${note.country}|${note.platform}`;
const state = {
  notes: [{ data_date: "2026-09-09", country: "印尼", platform: "示例平台 B", reason: "演示：部分订单需人工复核，已安排人员处理。", updated_by: "test-admin", updated_by_name: "演示管理员", updated_at: "2026-09-10T08:00:00Z" }],
  writes: [], failRead: false, failWrite: false,
};
function fixtureRow(date, platform, total, autoCount) {
  const success = total - 32;
  return { date, country: "印尼", platform, total, success, rejected: 32, successRate: success / total, rejectRate: 32 / total,
    autoCount, manualCount: total - autoCount, autoRate: autoCount / total, manualRate: (total - autoCount) / total,
    avgTime: "2分35秒", yesterdayAvgTime: "3分10秒", comparePercent: "-18.42%", sourceSheet: "local-ui-fixture", blockTitle: "2026-09" };
}
const payload = {
  meta: { year: "2026", month: "09", updatedAt: "2026-09-10T08:00:00Z", source: "supabase", message: "本地演示数据" },
  monthlyRows: [], operatorRows: [],
  dailyRows: [fixtureRow("2026-09-08", "示例平台 A", 4200, 1600), fixtureRow("2026-09-08", "示例平台 B", 1900, 1400),
    fixtureRow("2026-09-09", "示例平台 A", 4760, 1810), fixtureRow("2026-09-09", "示例平台 B", 2310, 1710)],
};
async function mockContext(browser, role = "owner") {
  const context = await browser.newContext({ viewport: { width: 1728, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await context.addInitScript(() => {
    const fixtureTime = new Date("2026-09-10T08:00:00Z").getTime();
    localStorage.setItem("hensem:dashboard:auth-session:v2", JSON.stringify({ access_token: "local-ui-token", refresh_token: "local-ui-refresh", expires_in: 3600, expires_at: fixtureTime / 1000 + 3600, user: { id: "test-admin" } }));
    localStorage.setItem("hensem.dashboard.last_activity", String(fixtureTime));
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" }, body: JSON.stringify(body) });
    if (url.hostname.endsWith("supabase.co")) {
      if (process.env.UI_TEST_DEBUG) console.log("mock", request.method(), url.pathname);
      assert.equal(url.hostname, "ui-test.supabase.co", "Local app must be configured with the mock Supabase host");
      if (request.method() === "OPTIONS") return json({});
      if (url.pathname === "/auth/v1/token") return json({ access_token: "local-ui-token", refresh_token: "local-ui-refresh", expires_in: 3600, user: { id: "test-admin" } });
      if (url.pathname.includes("dashboard_profiles")) return json([{ auth_user_id: "test-admin", username: "演示管理员", role, active: true, permissions: { home: true, auto_withdraw: true } }]);
      if (url.pathname.includes("functions/v1/")) return json({ ok: true, allowed: true });
      if (url.pathname.includes("auto_withdraw_notes")) {
        if (request.method() === "POST") {
          if (state.failWrite) return json({ message: "演示保存失败，稍后重试" }, 500);
          const body = request.postDataJSON();
          assert.equal(role, "owner", "Viewer must not attempt a write");
          state.writes.push(body);
          const saved = { ...body, updated_by: "test-admin", updated_by_name: "演示管理员", updated_at: "2026-09-10T08:10:00Z" };
          state.notes = [...state.notes.filter((note) => key(note) !== key(saved)), saved];
          return json([saved]);
        }
        if (state.failRead) return json({ message: "演示网络错误" }, 500);
        const dates = url.searchParams.getAll("data_date");
        const start = dates.find((value) => value.startsWith("gte."))?.slice(4) || "";
        const end = dates.find((value) => value.startsWith("lte."))?.slice(4) || "9999";
        return json(state.notes.filter((note) => note.data_date >= start && note.data_date <= end));
      }
      throw new Error(`Unmocked Supabase request ${url.pathname}`);
    }
    if (url.origin === origin && url.pathname === "/api/auto-withdraw") return json(payload);
    if (url.origin === origin && url.pathname === "/api/monthly-status") return json({});
    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-09-10T08:00:00Z"));
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); if (process.env.UI_TEST_DEBUG) console.log("pageerror", error.message); });
  if (process.env.UI_TEST_DEBUG) page.on("console", (message) => { if (message.type() === "error") console.log("browser", message.text()); });
  return { context, page, errors };
}
async function openDaily(page) {
  await page.goto(origin);
  try { await page.getByRole("button", { name: /提现\/自动出款统计/ }).click({ timeout: 15000 }); }
  catch (error) { console.error((await page.locator("body").innerText()).slice(0, 3000)); await page.screenshot({ path: path.join(output, "withdraw-notes-debug.png") }); throw error; }
  await page.getByRole("button", { name: "印尼盘口", exact: true }).click();
  await page.locator(".auto-note-cell-button").first().waitFor();
}
const platformRow = (page, platform = "示例平台 A") => page.locator(".auto-withdraw-daily-compact tbody tr").filter({ has: page.locator(".platform-cell", { hasText: platform }) });
async function openEditor(page, platform) {
  await platformRow(page, platform).locator(".auto-note-cell-button").click();
  await page.locator("#auto-note-reason").waitFor();
}
async function waitSaved(page) {
  await page.locator(".auto-note-modal").waitFor({ state: "hidden" });
  await page.locator(".auto-note-cell-button").first().waitFor();
}
async function queryRange(page, start, end) {
  await page.locator('input[type="date"]').nth(0).fill(start);
  await page.locator('input[type="date"]').nth(1).fill(end);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.locator(".auto-note-cell-button").first().waitFor();
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const { context, page, errors } = await mockContext(browser);
    await openDaily(page);
    assert.match(await platformRow(page).innerText(), /3分10秒/);
    assert.match(await platformRow(page).innerText(), /-18.42%/);
    const layout = await page.locator(".auto-withdraw-daily-compact").evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(layout.scroll <= layout.client + 1, `Wide desktop table overflows: ${JSON.stringify(layout)}`);
    await openEditor(page);
    const demoReason = "演示：10:00—11:20 自动通道维护，期间转人工处理；现已恢复。";
    await page.locator("#auto-note-reason").fill(demoReason);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByText("有未保存的修改", { exact: true }).waitFor();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    await page.getByRole("button", { name: "保存备注", exact: true }).click();
    await waitSaved(page);
    assert.equal(state.writes.at(-1).data_date, "2026-09-09");
    assert.equal(state.writes.at(-1).country, "印尼");
    assert.equal(state.writes.at(-1).platform, "示例平台 A");
    assert.match(await platformRow(page).innerText(), /自动通道维护/);
    assert.match(await platformRow(page, "示例平台 B").innerText(), /人工复核/);

    await openDaily(page);
    assert.match(await platformRow(page).innerText(), /自动通道维护/);
    await page.evaluate(() => {
      const banner = document.createElement("div");
      banner.id = "ui-fixture-banner";
      banner.textContent = "排版样本 · 以下数据与原因仅供演示";
      banner.style.cssText = "position:fixed;bottom:12px;left:240px;z-index:2000;padding:7px 14px;border:1px solid #c9dafa;border-radius:8px;background:#edf4ff;color:#365e94;font:12px sans-serif";
      document.body.appendChild(banner);
    });
    await page.screenshot({ path: path.join(output, "withdraw-notes-sample.png"), fullPage: true });
    await page.getByRole("button", { name: "展示样本", exact: true }).click();
    await page.getByText("以下平台、比例和原因均为演示内容，不代表实际异常，也不会写入业务数据。", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "withdraw-notes-demo-modal.png"), fullPage: true });
    await page.locator(".auto-note-sample").getByRole("button", { name: "关闭", exact: true }).click();

    await queryRange(page, "2026-09-08", "2026-09-09");
    assert.match(await platformRow(page).innerText(), /仅单日对比/);
    await openEditor(page);
    await page.locator("#auto-note-date").selectOption("2026-09-08");
    await page.locator("#auto-note-reason").fill("演示：8 日部分订单触发人工复核。");
    await page.getByRole("button", { name: "保存备注", exact: true }).click();
    await waitSaved(page);
    assert.equal(state.writes.at(-1).data_date, "2026-09-08");
    assert.match(await platformRow(page).innerText(), /2 天有备注/);
    await openEditor(page);
    assert.equal(await page.locator("#auto-note-date").inputValue(), "2026-09-09");
    await page.locator("#auto-note-reason").fill("演示：未保存草稿");
    await page.locator("#auto-note-date").selectOption("2026-09-08");
    await page.getByText("有未保存的修改", { exact: true }).waitFor();
    assert.equal(await page.locator("#auto-note-date").inputValue(), "2026-09-09");
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    assert.equal(await page.locator("#auto-note-date").inputValue(), "2026-09-08");
    state.failWrite = true;
    await page.locator("#auto-note-reason").fill("演示：保存失败时保留内容");
    await page.getByRole("button", { name: "保存备注", exact: true }).click();
    await page.getByText("演示保存失败，稍后重试", { exact: true }).waitFor();
    assert.equal(await page.locator("#auto-note-reason").inputValue(), "演示：保存失败时保留内容");
    state.failWrite = false;
    await page.locator("#auto-note-reason").fill("");
    await page.getByRole("button", { name: "保存备注", exact: true }).click();
    await waitSaved(page);
    assert.equal(state.writes.at(-1).reason, "");
    assert.match(await platformRow(page).innerText(), /1 天有备注/);
    state.failRead = true;
    await page.getByRole("button", { name: "刷新备注", exact: true }).click();
    await page.getByText(/备注暂时未能读取：演示网络错误/).waitFor();
    state.failRead = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.locator(".auto-note-cell-button").first().waitFor();
    assert.match(await platformRow(page, "示例平台 B").innerText(), /人工复核/);
    assert.deepEqual(errors, []);
    await context.close();

    const readonly = await mockContext(browser, "viewer");
    await openDaily(readonly.page);
    await openEditor(readonly.page);
    assert.equal(await readonly.page.getByRole("button", { name: "保存备注", exact: true }).count(), 0);
    assert.equal(await readonly.page.locator("textarea").count(), 0);
    assert.match(await readonly.page.locator(".auto-note-readonly").innerText(), /自动通道维护/);
    assert.deepEqual(readonly.errors, []);
    await readonly.context.close();
    console.log("PASS: yesterday display, desktop fit, save/reload, exact-date notes, unsaved guards, blank clearing, read/write failures, read-only access, demo screenshots.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
