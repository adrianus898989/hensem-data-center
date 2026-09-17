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
const actor = users.find(user => user.username === (process.env.UI_TEST_ACTOR || "admin"));
assert(actor, "Only synthetic fixture actors are allowed");
let failUpdates = 0, updateGate = null;
const mockSession = {
  access_token: "local-ui-fixture-token",
  refresh_token: "local-ui-fixture-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: actor.auth_user_id, email: "fixture@hensem.local" },
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
      if (url.pathname === "/rest/v1/dashboard_profiles") return json([actor]);
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
          assert(actor.role === "owner" || user.role === "viewer", "Admin peer permissions must stay read-only");
          if (updateGate) await updateGate;
          if (failUpdates) { failUpdates--; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fixture-save-failed" }) }); }
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
    await page.getByRole("button", { name: /权限管理/ }).click();
    await page.locator(".admin-permission-matrix tbody tr").first().waitFor();
    const rows = () => page.locator(".admin-account-table tbody > tr:not(.admin-account-editor-row)");
    const row = name => rows().filter({ has: page.locator(".admin-matrix-identity strong").filter({ hasText: new RegExp("^" + name + "$") }) });
    const dialog = () => page.getByRole("dialog", { name: /设置权限/ });
    const card = key => dialog().locator(".account-permission-card").filter({ has: page.locator("code").filter({ hasText: new RegExp("^" + key + "$") }) });
    const box = key => card(key).getByRole("checkbox");
    const mod = index => dialog().locator(".account-permission-module").nth(index).click();
    const filter = index => dialog().getByRole("group", { name: "按权限状态筛选" }).getByRole("button").nth(index).click();
    const search = () => dialog().getByLabel("搜索当前模块的权限");
    const updates = () => requests.filter(item => item.action === "update-account");
    const open = async (name, module = "home") => { await row(name).locator(".module-" + module).click(); await dialog().waitFor(); };
    const close = async () => { await dialog().getByRole("button", { name: "关闭权限设置", exact: true }).click(); await dialog().waitFor({ state: "hidden" }); };
    const confirm = async (action, accept) => {
      const event = page.waitForEvent("dialog"), operation = action(), native = await event, message = native.message();
      await (accept ? native.accept() : native.dismiss()); await operation; return message;
    };
    const wait = async (predicate, message) => { for(let i=0;i<200;i++){if(await predicate())return;await page.waitForTimeout(25);}assert.fail(message); };
    const screenshot = async name => { await page.screenshot({ path: "outputs/" + name, fullPage: true }); console.log("Screenshot: outputs/" + name); };
    fs.mkdirSync(path.join(process.cwd(), "outputs"), { recursive: true });
    assert.equal(await rows().count(), 9);
    assert.equal(await page.locator(".admin-account-editor").count(), 0);
    assert.equal(await page.locator("#admin-create-account").count(), 0);
    assert.match(await page.locator(".admin-permission-overview").textContent(), /5\s*权限模块.*8\s*权限项/);
    assert.equal(await row("admin").locator(".admin-module-permission-chip").count(), 5);
    assert.equal((await row("admin").locator(".admin-matrix-total").textContent()).replace(/\s/g,""), "8/8");
    assert.equal((await row("finance01").locator(".module-work_customer b").textContent()).replace(/\s/g,""), "0/2");
    const checkReadonly = async target => {
      assert.equal(await row(target).getByRole("button", {name:"账号设置",exact:true}).count(), 0);
      await open(target);
      const seen = [];
      for(let index=0;index<5;index++){
        await mod(index);
        assert(await dialog().getByRole("checkbox").evaluateAll(inputs => inputs.every(input => input.disabled)));
        if(target==="admin")assert(await dialog().getByRole("checkbox").evaluateAll(inputs => inputs.every(input => input.checked)));
        seen.push(...await dialog().locator(".account-permission-card code").allTextContents());
        assert(await dialog().getByRole("button",{name:"取消当前结果",exact:true}).isDisabled());
      }
      assert.deepEqual(seen, ["home","third_party","auto_withdraw","work_orders","customer_service","manage_viewers","refresh_data","view_audit"]);
      assert.equal(await dialog().getByRole("button",{name:"保存权限",exact:true}).count(),0);
      await dialog().getByRole("button",{name:"完成",exact:true}).click();await dialog().waitFor({state:"hidden"});
    };
    if(actor.role!=="owner"){
      await checkReadonly("admin");await checkReadonly("ops01");
      await open("report01");assert(await box("home").isChecked());assert(await box("home").isDisabled());
      await mod(4);assert(await dialog().getByRole("checkbox").evaluateAll(inputs=>inputs.every(i=>i.disabled&&!i.checked)));
      await mod(1);await box("third_party").uncheck();assert.equal(updates().length,0);
      await dialog().getByRole("button",{name:"保存权限",exact:true}).click();await dialog().waitFor({state:"hidden"});
      assert.deepEqual(updates(),[{action:"update-account",username:"report01",permissions:{...thirdPartyOnly,third_party:false}}]);
      await page.getByRole("button", { name: /账号管理/ }).click();
      await row("report01").getByRole("button",{name:"账号设置",exact:true}).click();
      assert.equal(await page.locator(".admin-account-role-editor").count(),0);
      assert.deepEqual(errors,[]);assert.deepEqual(rejectedOrigins,[]);
      console.log(JSON.stringify({result:"passed",actor:"admin",checks:["owner/peer readonly","home fixed","viewer business editable","no management or role patch"]}));
      return;
    }
    await screenshot("admin-permission-matrix.png");
    await open("ops01","management");await screenshot("admin-permission-dialog.png");await close();
    if(process.env.UI_MATRIX_ONLY==="1"){console.log("Minimum matrix/dialog preview passed");return;}
    const accountSearch=page.getByPlaceholder("输入账号、角色、模块或后台权限"),selects=page.locator(".admin-user-search-toolbar select");
    await accountSearch.fill("finance01");assert.equal(await rows().count(),1);await accountSearch.fill("");
    await selects.nth(0).selectOption("viewer");assert.equal(await rows().count(),5);
    await selects.nth(1).selectOption("disabled");assert.equal(await rows().count(),1);assert.match(await rows().textContent(),/archive01/);
    await selects.nth(0).selectOption("all");await selects.nth(1).selectOption("all");
    await accountSearch.fill("操作记录");assert.equal(await rows().count(),3);await accountSearch.fill("");
    await checkReadonly("admin");assert.equal(updates().length,0);
    await open("ops01","work_customer");await box("work_orders").uncheck();
    await mod(1);await box("third_party").uncheck();await mod(3);
    assert.equal(await box("work_orders").isChecked(),false);assert(await box("customer_service").isChecked());
    await filter(1);assert.deepEqual(await dialog().locator(".account-permission-card code").allTextContents(),["customer_service"]);
    await filter(2);assert.deepEqual(await dialog().locator(".account-permission-card code").allTextContents(),["work_orders"]);
    await dialog().getByRole("button",{name:"勾选当前结果",exact:true}).click();await filter(0);assert(await box("work_orders").isChecked());
    await search().fill("work_orders");await dialog().getByRole("button",{name:"取消当前结果",exact:true}).click();await search().fill("");
    assert.equal(await box("work_orders").isChecked(),false);assert(await box("customer_service").isChecked());
    await search().fill("no-such-permission");assert.equal(await dialog().getByRole("checkbox").count(),0);
    assert(await dialog().getByRole("button",{name:"勾选当前结果",exact:true}).isDisabled());
    await dialog().getByRole("button",{name:"清除筛选",exact:true}).click();await mod(4);
    await search().fill("refresh_data");await dialog().getByRole("button",{name:"取消当前结果",exact:true}).click();await search().fill("");
    assert(await box("manage_viewers").isChecked());assert(await box("view_audit").isChecked());
    assert.equal(await box("refresh_data").isChecked(),false);assert.equal(updates().length,0);
    assert.match(await dialog().locator("footer").textContent(),/已修改 3 项权限/);
    assert.match(await confirm(()=>dialog().getByRole("button",{name:"关闭权限设置",exact:true}).click(),false),/尚未保存/);
    assert(await dialog().isVisible());failUpdates=1;
    await dialog().getByRole("button",{name:"保存权限",exact:true}).click();await dialog().getByRole("alert").waitFor();
    assert.match(await dialog().getByRole("alert").textContent(),/修改已保留/);assert.equal(await box("refresh_data").isChecked(),false);
    assert.equal(updates().length,1);assert.deepEqual(users.find(user=>user.username==="ops01").permissions,fullPermissions);
    let release;updateGate=new Promise(resolve=>{release=resolve;});
    await dialog().getByRole("button",{name:"保存权限",exact:true}).evaluate(button=>{button.click();button.click();});
    await wait(()=>updates().length===2,"one retry request expected");assert.equal(await dialog().getAttribute("aria-busy"),"true");
    assert(await dialog().getByRole("button",{name:"关闭权限设置",exact:true}).isDisabled());release();updateGate=null;
    await dialog().waitFor({state:"hidden"});assert.equal(updates().length,2);
    assert.deepEqual(updates()[1],{action:"update-account",username:"ops01",permissions:{...fullPermissions,third_party:false,work_orders:false},management_permissions:{...management,refresh_data:false}});
    assert.equal(users.find(user=>user.username==="ops01").role,"admin");assert.equal(users.find(user=>user.username==="ops01").active,true);
    await open("finance01","third_party");await box("third_party").uncheck();
    assert.match(await confirm(()=>dialog().getByRole("button",{name:"取消",exact:true}).click(),true),/放弃修改/);
    await dialog().waitFor({state:"hidden"});assert.equal(updates().length,2);
    await open("finance01","third_party");assert(await box("third_party").isChecked());await close();
    await page.getByRole("button", { name: /账号管理/ }).click();
    await row("finance01").getByRole("button",{name:"账号设置",exact:true}).click();
    const editor=page.locator(".admin-account-editor");
    assert.equal(await editor.count(),1);assert.equal(await editor.getByLabel("账号角色",{exact:true}).inputValue(),"admin");
    for(const name of ["保存角色","停用","重置密码","删除账号"])assert.equal(await editor.getByRole("button",{name,exact:true}).count(),1);
    await editor.getByRole("button",{name:"重置密码",exact:true}).click();await page.getByPlaceholder("输入新的临时密码（至少 8 位）").waitFor();
    await page.locator(".admin-inline-reset").getByRole("button",{name:"取消",exact:true}).click();
    assert.match(await confirm(()=>editor.getByRole("button",{name:"删除账号",exact:true}).click(),false),/finance01/);
    assert(!requests.some(request=>["delete-account","reset-password"].includes(request.action)));
    await editor.getByRole("button",{name:"停用",exact:true}).click();await editor.getByRole("button",{name:"启用",exact:true}).waitFor();
    assert.deepEqual(updates().at(-1),{action:"update-account",username:"finance01",active:false});
    await editor.getByRole("button",{name:"启用",exact:true}).click();await editor.getByRole("button",{name:"停用",exact:true}).waitFor();
    await row("finance01").getByRole("button",{name:/收起账号设置/}).click();
    await page.getByRole("button",{name:"+ 新建账号",exact:true}).click();const create=page.locator("#admin-create-account");
    assert.deepEqual(await create.locator("input[type=checkbox]").evaluateAll(inputs=>inputs.map(i=>i.checked)),[true,false,false]);
    await create.getByRole("button",{name:/小管理员/}).click();
    assert.deepEqual(await create.locator("input[type=checkbox]").evaluateAll(inputs=>inputs.map(i=>i.checked)),[true,true,true,true,true,true]);
    await create.getByRole("button",{name:"取消",exact:true}).click();assert(!requests.some(r=>r.action==="create-account"));
    await page.getByRole("button", { name: /权限管理/ }).click();
    const responsive=[];
    for(const viewport of [{width:1728,height:1080},{width:1366,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.locator(".admin-permission-matrix").scrollIntoViewIfNeeded();
      let size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert(size.scroll<=size.width+1,"Matrix document overflow at "+viewport.width);
      if(viewport.width===390)await screenshot("admin-permission-matrix-mobile.png");
      await open("finance01","management");await box("view_audit").uncheck();
      for(const name of ["关闭权限设置","保存权限","取消"]){
        const button=dialog().getByRole("button",{name,exact:true});await button.scrollIntoViewIfNeeded();
        assert(await button.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&!!top&&(el===top||el.contains(top));}),name+" inaccessible at "+viewport.width);
      }
      size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert(size.scroll<=size.width+1,"Dialog document overflow at "+viewport.width);
      if(viewport.width===390)await screenshot("admin-permission-dialog-mobile.png");
      await confirm(()=>dialog().getByRole("button",{name:"取消",exact:true}).click(),true);await dialog().waitFor({state:"hidden"});
      responsive.push({...viewport,horizontalOverflow:false,footerAccessible:true});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(rejectedOrigins,[],"No external traffic");
    console.log(JSON.stringify({result:"passed",actor:"owner",modules:5,permissions:8,checks:["matrix counts","search filters","readonly owner/home","draft preserved across modules","scoped batch","no autosave","cancel/dirty close","failed save retains draft","one explicit save patch","account entrances preserved","delete cancellation","creation defaults"],responsive},null,2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
