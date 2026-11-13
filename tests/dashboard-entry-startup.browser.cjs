// Run against the static export with PLAYWRIGHT_PATH as needed. Every request is intercepted locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test, before, after} = require('node:test');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const output = path.resolve(process.env.DASHBOARD_BROWSER_OUT || path.join(__dirname, '../out'));
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
const appScript = html.match(/src="([^"]*\/_next\/static\/chunks\/app\/page-[^"]+\.js)"/)[1];
const base = appScript.slice(0, appScript.indexOf('/_next/')) + '/';
const gateway = 'https://entry.offline.test';
const entry = gateway + base;
const webpack = /\/_next\/static\/chunks\/webpack-[^/]+\.js$/;
const unavailable = 'deleted-build-page.js';
const automaticTimeout = 45000;
let browser;
before(async () => {browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless:true});});
after(async () => {await browser?.close();});

async function fixture(t, mode, embedded=false) {
  const context = await browser.newContext({serviceWorkers:'block'});
  t.after(() => context.close());
  const requests = {documents:0, failed:0, api:[], reportBundles:[], paths:[]};
  const page = await context.newPage();
  const emulate = mode==='offline' ? await context.newCDPSession(page) : null;
  const offline = value => emulate?.send('Network.emulateNetworkConditions',{
    offline:value, latency:0, downloadThroughput:-1, uploadThroughput:-1
  });
  let broken = true;
  let heldScript;
  const held = new Promise(resolve => {heldScript=resolve;});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if(url.origin==='https://embed.offline.test' && url.pathname==='/outer'){
      return route.fulfill({contentType:'text/html',body:'<iframe src="'+entry+'"></iframe>'});
    }
    if(request.isNavigationRequest() && request.resourceType()==='document'){
      assert.equal(url.origin,gateway);assert.equal(url.pathname,base);
      requests.documents++;
      const body = mode==='stale' && requests.documents===1 ? html.replaceAll(path.basename(appScript), unavailable) : html;
      return route.fulfill({contentType:'text/html',body});
    }
    if(url.origin!==gateway || !url.pathname.startsWith(base) ||
       request.method()!=='GET' || /\/api\/|\/auth\/|\/rest\/|\/functions\//.test(url.pathname)){
      requests.api.push(request.method()+' '+url.origin+url.pathname);return route.abort();
    }
    requests.paths.push(url.pathname);
    if(url.pathname.endsWith(unavailable) || (broken && mode==='missing' && webpack.test(url.pathname))){
      requests.failed++;
      return route.fulfill({status:404,contentType:'text/plain',body:'Asset does not exist'});
    }
    if(broken && mode==='offline' && url.pathname===appScript){
      requests.failed++;
      await offline(true);
      return route.abort('internetdisconnected');
    }
    if(mode==='late' && url.pathname===appScript){
      await held;
    }
    if(broken && mode==='hang' && url.pathname===appScript){
      requests.failed++;
      return; // Keep the route pending until navigation cancels it.
    }
    const file = path.join(output,url.pathname.slice(base.length));
    if(!fs.existsSync(file) || !fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    if(request.resourceType()==='script' && fs.readFileSync(file,'utf8').includes('HensemAmountRateData')){
      requests.reportBundles.push(url.pathname);
    }
    return route.fulfill({path:file});
  });
  // An independent context never shares a user's saved session or tabs.
  await page.goto(embedded?'https://embed.offline.test/outer':entry,{waitUntil:'commit'});
  const view = embedded ? page.frameLocator('iframe') : page;
  return {page,view,requests,restore(){broken=false;heldScript();return offline(false);}};
}
const password = view => view.locator('input[autocomplete=current-password]');
const recovery = view => view.getByRole('button',{name:'重新加载后台'});
async function login(h) {
  await password(h.view).waitFor({timeout:automaticTimeout});
  assert.equal(await h.view.getByRole('button',{name:'安全登录',exact:true}).count(),1);
  assert.deepEqual(h.requests.api,[]);
  assert.deepEqual(h.requests.reportBundles,[], 'The logged-out startup downloaded the administrative reports');
}

test('healthy top-level startup shows the login form with no report, account or login requests', async t => {
  const h=await fixture(t,'healthy');
  await login(h);
  assert.equal(h.requests.documents,1);
  assert.equal(await recovery(h.view).count(),0);
});

test('a framed document never mounts the login form or starts authenticated or report reads', async t => {
  const h=await fixture(t,'healthy',true);
  await h.view.getByText('请单独打开数据中控后台',{exact:true}).waitFor();
  assert.equal(await password(h.view).count(),0);assert.equal(await recovery(h.view).count(),0);
  assert.equal(h.requests.documents,1);assert.deepEqual(h.requests.api,[]);assert.deepEqual(h.requests.reportBundles,[]);
});

test('stale HTML with a removed page chunk re-reads the entry once and hydrates the fresh export', async t => {
  const h=await fixture(t,'stale');
  await login(h);
  assert.ok(h.requests.failed>=1);
  assert.equal(h.requests.documents,2);
});

for(const mode of ['missing','hang']){
  test(mode+' critical script ends with an actionable recovery; manual retry hydrates the fresh page', async t => {
    const h=await fixture(t,mode);
    await recovery(h.view).waitFor({timeout:automaticTimeout});
    assert.equal(await password(h.view).count(),0);
    // Automatic recovery can navigate once. Wait across a fresh deadline to catch reload loops.
    await h.page.waitForTimeout(13500);
    await recovery(h.view).waitFor({timeout:automaticTimeout});
    assert.ok(h.requests.documents<=2,'Unbounded automatic reloads: '+h.requests.documents);
    assert.ok(h.requests.failed>0);assert.deepEqual(h.requests.api,[]);
    const before=h.requests.documents;
    await h.restore();
    await recovery(h.view).click({timeout:5000,noWaitAfter:true});
    await login(h);
    assert.equal(h.requests.documents,before+1);
  });
}

test('going offline during startup pauses recovery until a real online event and retains the protected guest state', async t => {
  const h=await fixture(t,'offline');
  await h.view.getByText(/网络已断开/).waitFor({timeout:automaticTimeout});
  assert.equal(await h.page.evaluate(()=>navigator.onLine),false);
  assert.equal(await password(h.view).count(),0);
  assert.deepEqual(h.requests.api,[]);
  assert.equal(h.requests.documents,1);
  await h.restore();
  await login(h);
  assert.equal(h.requests.documents,2);
});

test('a slow page chunk that eventually arrives hydrates normally and cancels pending automatic recovery', async t => {
  const h=await fixture(t,'late');
  await h.view.getByText('后台页面加载时间较长。',{exact:true}).waitFor({timeout:automaticTimeout});
  assert.equal(await password(h.view).count(),0);
  await h.restore();
  await login(h);
  assert.equal(await h.page.locator('html[data-entry-state]').count(),0);
  assert.equal(h.requests.documents,1);
});
