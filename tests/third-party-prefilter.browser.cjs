// Real React + browser interactions with synthetic metadata and deferred replies.
// No login, customer data, database writes or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), modules = {};
for (const dir of ['src/lib', 'src/components']) for (const name of fs.readdirSync(path.join(root, dir))) {
  if (!/\.tsx?$/.test(name)) continue;
  const key = name.replace(/\.tsx?$/, '');
  if (modules[key]) throw new Error('Duplicate fixture module ' + key);
  modules[key] = ts.transpileModule(fs.readFileSync(path.join(root, dir, name), 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment'},
  }).outputText;
}
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const dom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const css = ['src/app/globals.css', ...fs.readdirSync(path.join(root, 'src/components')).filter(n => n.endsWith('.css')).map(n => 'src/components/' + n)]
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const safe = value => value.replace(/<\/script/gi, '<\\/script');
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  const context = await browser.newContext({viewport: {width: 1720, height: 960}, serviceWorkers: 'block'});
  const page = await context.newPage(), errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {external.push(route.request().url()); return route.abort();});
  try {
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}
      body{padding:16px;background:#f3f6fa}.test-note{font:12px sans-serif;color:#64748b;margin-bottom:12px}
      </style><body><div class="test-note">本地交互验证 · 全部为示例数据</div><div id="app"></div>
      <script>${safe(react)}</script><script>${safe(dom)}</script><script>
      const __jsx=React.createElement,__Fragment=React.Fragment,sources=${safe(JSON.stringify(modules))},cache={};
      const Auth=React.createContext(null);
      window.testCalls=[];window.pending=[];
      const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
      const catalog={platforms:[{country:'印度',platform:'SampleIN'},{country:'巴基斯坦',platform:'92R'},
        {country:'巴基斯坦',platform:'92BLAZE'},{country:'香港',platform:'EK7'},{country:'香港',platform:'GEM7'},{country:'香港',platform:'MAX7'}]};
      function volume(url){const q=new URL(url,'https://test.invalid').searchParams,country=q.get('country'),date=q.get('start');
        return {meta:{updatedAt:new Date().toISOString()},rows:[{id:'fixture',date,country,platform:country==='巴基斯坦'?'92R':'SampleIN',
          channel:country==='巴基斯坦'?'SamplePKPay':'SampleINPay',rawChannel:country==='巴基斯坦'?'SamplePKPay':'SampleINPay',
          channelType:'BANK',direction:'代收',amount:country==='巴基斯坦'?111:222,count:1}],
          collectionSuccessSnapshots:[],withdrawPendingSnapshots:[],withdrawActualRows:[],workOrderDepositRows:[]};}
      window.resolveVolume=index=>{const p=window.pending[index];if(!p)throw Error('Missing deferred request');p.resolve(json(volume(p.url)));};
      async function business(url,init){window.testCalls.push(url);
        if(url.startsWith('/api/third-party-filter-options'))return json(catalog);
        if(url.startsWith('/api/supabase-third-party-volume'))return new Promise(resolve=>window.pending.push({url,resolve}));
        if(url.startsWith('/api/supabase-third-party-rates'))return json({meta:{updatedAt:new Date().toISOString()},rates:[{country:'巴基斯坦',thirdParty:'SamplePKPay',collectFee:'1%',payoutFee:'1%'}],platformStatuses:[]});
        if(url.startsWith('/api/supabase-third-party-sync-status'))return json({});
        throw Error('Unexpected fixture API '+url);}
      function require(name){
        if(name==='react')return React;if(name.endsWith('.css'))return {};
        const key=name.split('/').pop();
        if(key==='DashboardAuthGate')return {useDashboardAuth:()=>React.useContext(Auth)};
        if(key==='dashboardDataClient')return {dashboardBusinessFetch:business,isDashboardDataDenied:()=>false,readDashboardDataCache:()=>null,writeDashboardDataCache:()=>{}};
        if(key==='dashboardAuthClient')return {dashboardAuthenticatedFetch:async()=>json({rows:[],platforms:[]})};
        if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unexpected module '+name);
        const m={exports:{}};cache[key]=m;new Function('require','module','exports','__jsx','__Fragment','process',sources[key])
          (require,m,m.exports,__jsx,__Fragment,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid'}});return m.exports;
      }
      function TestApp(){const [auth,setAuth]=React.useState({session:{access_token:'FIXTURE_ONLY',user:{id:'fixture-a'}},
        profile:{auth_user_id:'fixture-a',role:'owner',active:true,data_scope:{mode:'all',countries:[]},updated_at:'2026-09-19T00:00:00Z'}});
        window.testSetAuth=setAuth;return React.createElement(Auth.Provider,{value:auth},React.createElement(require('./ThirdPartyVolumeDashboard').default));}
      ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(TestApp));
      </script></body></html>`);
    await page.getByRole('button', {name: '巴基斯坦盘口', exact: true}).waitFor();
    await page.waitForFunction(() => window.testCalls.some(url => url.startsWith('/api/third-party-filter-options')));
    await page.getByRole('button', {name: '巴基斯坦盘口', exact: true}).click();
    await page.getByRole('button', {name: '平台', exact: true}).click();
    await page.getByRole('checkbox', {name: '92R', exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.testCalls.filter(url => /third-party-volume|third-party-rates/.test(url))), [], 'opening/switching only loads metadata');
    await page.getByPlaceholder('搜索平台', {exact: true}).fill('92R');
    await page.getByRole('checkbox', {name: '92R', exact: true}).check();
    assert.equal(await page.getByRole('checkbox').count(), 1, 'search works before a report query');
    const output = path.join(root, 'outputs', 'third-party-platform-prefilter.png');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    await page.screenshot({path: output, fullPage: true});
    await page.getByRole('button', {name: '完成', exact: true}).click();
    await page.getByRole('button', {name: '印度线下盘口', exact: true}).click();
    await page.getByRole('button', {name: '查询', exact: true}).click();
    await page.waitForFunction(() => window.pending.length === 1);
    await page.getByRole('button', {name: '巴基斯坦盘口', exact: true}).click();
    await page.getByRole('button', {name: '查询', exact: true}).click();
    await page.waitForFunction(() => window.pending.length === 2);
    await page.evaluate(() => window.resolveVolume(1));
    await page.getByText('SamplePKPay', {exact: true}).first().waitFor();
    await page.evaluate(() => window.resolveVolume(0));
    await page.waitForFunction(() => !document.querySelector('.volume-query-btn')?.disabled);
    assert.equal(await page.getByText('SampleINPay', {exact: true}).count(), 0, 'late India response cannot replace Pakistan');
    assert(await page.getByText('SamplePKPay', {exact: true}).count(), 'Pakistan result stays visible');
    await page.evaluate(() => window.testSetAuth(old => ({...old, session: {...old.session,access_token:'REFRESH_FIXTURE_ONLY'}})));
    assert(await page.getByText('SamplePKPay', {exact: true}).count(), 'token refresh preserves selected country/result');
    assert.equal(await page.locator('.country-tab-row .active').innerText(), '巴基斯坦盘口');
    await page.getByRole('button', {name: '香港盘口', exact: true}).click();
    assert.equal(await page.getByText('SamplePKPay', {exact: true}).count(), 0, 'switching country hides old-country results immediately');
    await page.getByRole('button', {name: '平台', exact: true}).click();
    await page.getByRole('checkbox', {name: 'EK7', exact: true}).waitFor();
    assert.equal(await page.getByRole('checkbox', {name: '92R', exact: true}).count(), 0);
    await page.getByRole('button', {name: '完成', exact: true}).click();
    for (const width of [1024, 390]) {
      await page.setViewportSize({width,height:960});
      assert(await page.getByRole('button', {name:'查询',exact:true}).isVisible());
    }
    assert.deepEqual(errors, []);assert.deepEqual(external, []);
    console.log(JSON.stringify({passed:true,externalRequests:0,screenshot:output,
      checks:['platform selection before report','no automatic India report','no business requests on country switch',
        'old response ignored after switching','token refresh preserves view','country-scoped options','narrow viewport controls']}));
  } finally {await context.close();await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
