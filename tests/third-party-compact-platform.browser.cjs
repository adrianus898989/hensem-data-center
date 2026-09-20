// Real React hooks + isolated Chrome. Synthetic metadata/aggregates only;
// every outbound request is blocked, and no user profile or account is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), modules = {};
for (const dir of ['src/lib', 'src/components']) for (const name of fs.readdirSync(path.join(root, dir))) {
  if (!/\.tsx?$/.test(name)) continue;
  const key = name.replace(/\.tsx?$/, '');
  assert(!modules[key], 'Duplicate fixture module: ' + key);
  modules[key] = ts.transpileModule(fs.readFileSync(path.join(root, dir, name), 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment'},
  }).outputText;
}
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const dom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const css = ['src/app/globals.css', ...fs.readdirSync(path.join(root, 'src/components')).filter(n => n.endsWith('.css')).map(n => 'src/components/' + n)]
  .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const safe = value => value.replace(/<\/script/gi, '<\\/script');
const ek7Id = '11111111-1111-4111-8111-111111111111';

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  const context = await browser.newContext({viewport: {width: 1720, height: 960}, locale: 'en-GB', serviceWorkers: 'block'});
  const page = await context.newPage(), errors = [], external = [], geometry = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {external.push(route.request().url()); return route.abort();});
  const output = path.join(root, 'outputs', 'third-party-compact-platform.png');
  try {
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}
      body{margin:0;background:#f3f6fa}.fixture-frame{display:grid;grid-template-columns:230px minmax(0,1fr)}
      .fixture-sidebar{background:#102039;color:#fff;padding:24px;font:14px sans-serif}
      .fixture-main{min-width:0;padding:10px;box-sizing:border-box}
      @media(max-width:680px){.fixture-frame{grid-template-columns:minmax(0,1fr)}.fixture-sidebar{display:none}}
      </style><body><div class="fixture-frame"><aside class="fixture-sidebar">隔离布局测试<br>230 px 侧栏</aside><main class="fixture-main"><div id="app"></div></main></div>
      <script>${safe(react)}</script><script>${safe(dom)}</script><script>
      const __jsx=React.createElement,__Fragment=React.Fragment,sources=${safe(JSON.stringify(modules))},cache={};
      const Auth=React.createContext(null),ek7Id=${JSON.stringify(ek7Id)};
      window.testCalls=[];window.orderCalls=[];window.pendingOrders=[];
      const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
      const details=[{id:ek7Id,name:'EK7',team:'香港'}];
      const catalog={platforms:[{country:'印度',platform:'SampleIN'},{country:'香港',platform:'EK7'},
        {country:'香港',platform:'LegacyHK'},{country:'巴基斯坦',platform:'SamplePK'}]};
      function orderPayload(body){return {platforms:details,platform:'EK7',team:'香港',basis:body.p_basis,timezone:'Asia/Kolkata',rows:[{
        direction:body.p_direction,provider:'FixturePay',channel_type:'BANK',created_date:'2026-09-19',success_date:'2026-09-19',
        submitted_count:10,submitted_amount:1000,success_count:8,success_amount:800,actual_amount:780,withdraw_fee:20,
        cross_day_count:0,cross_day_amount:0,earlier_count:0,earlier_amount:0,missing_success_time_count:0,
        pending_count:1,pending_amount:100,first_created_at:body.p_start_at,last_created_at:body.p_start_at,
        first_success_at:body.p_start_at,last_success_at:body.p_start_at,last_synced_at:'2026-09-20T00:00:00Z'}]};}
      window.resolveOrders=(failure=false)=>{const pending=window.pendingOrders.splice(0);for(const p of pending)
        p.resolve(failure?json({message:'示例查询失败，请重试。'},500):json(orderPayload(p.body)));};
      async function business(url){window.testCalls.push(url);
        if(url.startsWith('/api/third-party-filter-options'))return json(catalog);
        if(url.startsWith('/api/supabase-third-party-rates'))return json({meta:{updatedAt:new Date().toISOString()},rates:[
          {country:'香港',thirdParty:'FixturePay',collectFee:'1%',payoutFee:'1%'}],platformStatuses:[]});
        if(url.startsWith('/api/supabase-third-party-sync-status'))return json({});
        if(url.startsWith('/api/supabase-third-party-volume'))return json({meta:{updatedAt:new Date().toISOString()},rows:[
          {id:'legacy',date:'2026-09-19',country:'香港',platform:'LegacyHK',channel:'LegacyPay',rawChannel:'LegacyPay',channelType:'BANK',direction:'代收',amount:77,count:1}],
          collectionSuccessSnapshots:[],withdrawPendingSnapshots:[],withdrawActualRows:[],workOrderDepositRows:[]});
        throw Error('Unexpected fixture API '+url);}
      async function authenticated(url,init){
        if(!url.endsWith('/rest/v1/rpc/dashboard_order_time_query'))throw Error('Unexpected fixture RPC '+url);
        const body=JSON.parse(init.body);window.orderCalls.push(body);
        if(!body.p_platform)return json({rows:[],platforms:details,timezone:'Asia/Kolkata'});
        return new Promise(resolve=>window.pendingOrders.push({body,resolve}));
      }
      function require(name){
        if(name==='react')return React;if(name.endsWith('.css'))return {};
        const key=name.split('/').pop();
        if(key==='DashboardAuthGate')return {useDashboardAuth:()=>React.useContext(Auth)};
        if(key==='dashboardDataClient')return {dashboardBusinessFetch:business,isDashboardDataDenied:()=>false,readDashboardDataCache:()=>null,writeDashboardDataCache:()=>{}};
        if(key==='dashboardAuthClient')return {dashboardAuthenticatedFetch:authenticated};
        if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unexpected module '+name);
        const m={exports:{}};cache[key]=m;new Function('require','module','exports','__jsx','__Fragment','process',sources[key])
          (require,m,m.exports,__jsx,__Fragment,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid'}});return m.exports;
      }
      function TestApp(){const auth={session:{access_token:'FIXTURE_ONLY',user:{id:'fixture-a'}},
        profile:{auth_user_id:'fixture-a',role:'owner',active:true,data_scope:{mode:'all',countries:[]},updated_at:'2026-09-19T00:00:00Z'}};
        return React.createElement(Auth.Provider,{value:auth},React.createElement(require('./ThirdPartyVolumeDashboard').default));}
      ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(TestApp));
      </script></body></html>`);
    await page.getByRole('button', {name: '香港盘口', exact: true}).click();
    await page.getByRole('button', {name: '平台', exact: true}).click();
    await page.getByRole('checkbox', {name: 'EK7', exact: true}).waitFor();
    await page.getByRole('checkbox', {name: 'LegacyHK', exact: true}).waitFor();
    await page.getByRole('button', {name: '完成', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => window.testCalls.filter(url => /third-party-volume|third-party-rates/.test(url))), []);
    await page.getByLabel('开始时间', {exact: true}).fill('2026-09-19T05:00:01');
    await page.getByLabel('结束时间', {exact: true}).fill('2026-09-19T23:59:59');
    assert.equal(await page.locator('.time-pending-note').count(),0,'changed filters do not show the removed caption');

    async function measure(label, count, oneRow = false) {
      const value = await page.locator('.volume-time-filter-grid').evaluate(element => {
        const fields = [...element.children].map(field => {const r=field.getBoundingClientRect(),control=field.querySelector('input,select,button').getBoundingClientRect();return {top:r.top,controlTop:control.top,left:r.left,right:r.right,width:r.width};});
        const dates = [...element.querySelectorAll('input[type="datetime-local"]')].map(input => ({width:input.getBoundingClientRect().width,step:input.step,value:input.value}));
        const form = element.closest('form'),r=form.getBoundingClientRect();
        return {fields,dates,form:{left:r.left,right:r.right,width:r.width,clientWidth:form.clientWidth,scrollWidth:form.scrollWidth},viewport:innerWidth,documentWidth:document.documentElement.scrollWidth};
      });
      geometry.push({label,...value});
      assert.equal(value.fields.length,count,label+' field count');
      if(oneRow)assert(value.fields.every(field=>Math.abs(field.controlTop-value.fields[0].controlTop)<1),label+' fields share one row');
      assert(value.form.left>=0&&value.form.right<=value.viewport+1,label+' form fits viewport');
      assert(value.form.scrollWidth<=value.form.clientWidth+1,label+' form does not overflow');
      assert(value.documentWidth<=value.viewport+1,label+' page does not overflow');
      assert(value.fields.every(field=>field.left>=value.form.left&&field.right<=value.form.right),label+' all fields fit form');
      for(const date of value.dates){assert.equal(date.step,'1',label+' seconds preserved');assert(date.width>=210,label+' date/time has readable width');}
      return value;
    }
    async function checkTypeMenu(width) {
      await page.getByRole('button',{name:'类型 / 钱包',exact:true}).click();
      const menu=await page.locator('.volume-multi-menu').boundingBox();
      assert(menu&&menu.x>=-1&&menu.x+menu.width<=width+1,width+' last-column type menu fits viewport');
      await page.getByRole('button',{name:'完成',exact:true}).click();
    }
    await measure('1720 / 230 sidebar / seven fields',7,true);
    await checkTypeMenu(1720);
    await page.getByRole('button', {name:'查询',exact:true}).click();
    await page.waitForFunction(() => window.pendingOrders.length===2);
    await page.getByRole('status').filter({hasText:'正在分段读取'}).waitFor();
    assert.equal(await page.locator('.order-query-help').count(),0,'redundant explanation removed, progress retained');
    const shards=await page.evaluate(()=>window.orderCalls.filter(body=>body.p_platform));
    assert.equal(shards.length,2,'real batch hook splits charge and withdraw');
    assert(shards.every(body=>body.p_platform===ek7Id),'automatic all-platform partial query only requests supported platform');
    assert(shards.every(body=>body.p_start_at==='2026-09-18T23:30:01.000Z'&&body.p_end_at==='2026-09-19T18:30:00.000Z'),'selected seconds reach RPC');
    assert.equal(await page.evaluate(()=>window.testCalls.filter(url=>url.includes('third-party-volume')).length),0,'partial-hours never use daily totals');
    await page.evaluate(()=>window.resolveOrders());
    await page.getByText('FixturePay',{exact:true}).first().waitFor();
    assert.equal(await page.locator('.order-result-context').count(),0,'large result explanation removed');
    assert.equal(await page.locator('.business-query-error').count(),0,'unsupported unselected platforms do not block automatic query');
    fs.mkdirSync(path.dirname(output),{recursive:true});
    await page.screenshot({path:output,fullPage:true});

    await page.getByRole('button',{name:'平台',exact:true}).click();
    await page.getByRole('checkbox',{name:'LegacyHK',exact:true}).check();
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await page.getByRole('button',{name:'查询',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'LegacyHK'}).waitFor();
    assert.equal(await page.evaluate(()=>window.orderCalls.filter(body=>body.p_platform).length),2,'explicit unsupported platform does not broaden to supported selection');
    assert.equal(await page.evaluate(()=>window.testCalls.filter(url=>url.includes('third-party-volume')).length),0,'explicit legacy selection does not relabel a daily total as hourly');
    assert(await page.getByText('FixturePay',{exact:true}).count(),'failed query preserves old result');

    await page.getByRole('button',{name:'平台',exact:true}).click();
    await page.getByRole('checkbox',{name:'LegacyHK',exact:true}).uncheck();
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await page.getByRole('button',{name:'查询',exact:true}).click();
    await page.waitForFunction(()=>window.pendingOrders.length===2);
    await page.getByRole('status').filter({hasText:'正在分段读取'}).waitFor();
    await page.evaluate(()=>window.resolveOrders(true));
    await page.getByRole('alert').filter({hasText:'示例查询失败，请重试。'}).waitFor();
    assert(await page.getByText('FixturePay',{exact:true}).count(),'query errors remain visible without deleting last success');

    await page.getByRole('button',{name:'所有国家USDT',exact:true}).click();
    await measure('1720 / 230 sidebar / eight fields',8,true);
    await checkTypeMenu(1720);
    for(const width of [1200,1024,390]) {
      await page.setViewportSize({width,height:960});
      await measure(width+' / USDT responsive',8);
      await page.getByLabel('开始时间',{exact:true}).fill('2026-09-19T05:00:02');
      assert.equal(await page.getByLabel('开始时间',{exact:true}).inputValue(),'2026-09-19T05:00:02');
      await page.getByRole('button',{name:'平台',exact:true}).click();
      await page.getByPlaceholder('搜索平台',{exact:true}).fill('EK7');
      await page.getByRole('checkbox',{name:'EK7',exact:true}).check();
      const dropdown=await page.locator('.volume-multi-menu').boundingBox();
      assert(dropdown&&dropdown.x>=-1&&dropdown.x+dropdown.width<=width+1,width+' platform dropdown fits viewport');
      await page.getByRole('button',{name:'完成',exact:true}).click();
      await checkTypeMenu(width);
      await page.getByRole('button',{name:'香港盘口',exact:true}).click();
      await measure(width+' / country responsive',7);
      await checkTypeMenu(width);
      assert(await page.getByRole('button',{name:'查询',exact:true}).isVisible());
      await page.getByRole('button',{name:'所有国家USDT',exact:true}).click();
    }
    await page.setViewportSize({width:1720,height:960});
    await page.getByRole('button',{name:'香港盘口',exact:true}).click();
    await page.getByLabel('开始时间',{exact:true}).fill('2026-09-19T00:00:00');
    await page.getByLabel('结束时间',{exact:true}).fill('2026-09-19T23:59:59');
    await page.getByRole('button',{name:'查询',exact:true}).click();
    await page.getByText('LegacyPay',{exact:true}).first().waitFor();
    assert.equal(await page.locator('.time-pending-note,.volume-legacy-note,.volume-applied-range').count(),0,'all three redundant captions are absent from daily results');
    assert(await page.getByRole('button',{name:'查询',exact:true}).isEnabled(),'daily query remains operable');
    await page.screenshot({path:path.join(root,'outputs','summary-captions-removed.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(JSON.stringify({passed:true,externalRequests:0,screenshot:output,geometry,
      checks:['seven/eight fields in one desktop row','sidebar-aware narrow layout','seconds preserved','platform picker operable',
        'automatic supported-platform intersection','explicit unsupported platform guarded','no false hourly daily totals','explanation hidden','progress/errors preserved']}));
  } finally {await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
