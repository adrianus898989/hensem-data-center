/* Actual production MonthlyTable + production success helper. Offline fixtures only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/jun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.SUCCESS_UI_OUTPUT || path.join(root, 'outputs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const modules = {}, styles = new Set(['src/app/globals.css']);
const stubs = new Set(['DashboardAuthGate', 'dashboardDataClient', 'monthlyStatusClient', 'ThirdPartyRatesDashboard']);
function include(file) {
  const key = path.basename(file).replace(/\.tsx?$/, '');
  if (modules[key] || stubs.has(key)) return;
  let source = read(file);
  if (key === 'ThirdPartyVolumeDashboard') source += '\nexport const __qa = {MonthlyTable, aggregateCombo, buildFeeCompareRows};';
  modules[key] = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,jsxFactory:'__jsx',jsxFragmentFactory:'__Fragment'}}).outputText;
  for (const m of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    const target=m[1];
    if (target.endsWith('.css')) {styles.add(path.normalize(path.join(path.dirname(file),target)));continue;}
    if (!target.startsWith('.')&&!target.startsWith('@/')) continue;
    const base=target.startsWith('@/')?'src/'+target.slice(2):path.join(path.dirname(file),target);
    const resolved=['.tsx','.ts'].map(ext=>base+ext).find(f=>fs.existsSync(path.join(root,f)));
    if(resolved)include(resolved);
  }
}
include('src/components/ThirdPartyVolumeDashboard.tsx');
const css=[...styles].map(read).join('\n');
const react=fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')),'umd/react.development.js'),'utf8');
const dom=fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js'),'utf8');
const day='2026-09-13',previous='2026-09-12';
const channels=['UPI-QR','ArbPay','ICPay','WPay','RAPay','NewWinPay','FancyPay','VstarPay'];
let id=0;
const volumeRows=channels.flatMap((channel,i)=>['91CLUB','55CLUB','IN999'].flatMap((platform,p)=>['代收','代付'].map(direction=>({id:String(++id),date:day,country:'印度',platform,channel,rawChannel:channel,channelType:'UPI',direction,amount:direction==='代收'?1000000*(9-i)+p:700000*(9-i)+p,count:direction==='代收'?1000*(9-i)+p:700*(9-i)+p,sheetName:'合成验收',sourceRow:id,successRate:1,successCount:999999}))));
const snapshots=['91CLUB','55CLUB','IN999'].flatMap((platform,p)=>[day,previous].map((date,d)=>({schema_version:1,source_system:'RECHARGE_REVIEW',country_code:'IN',platform,stat_date:date,timezone:'Asia/Kolkata',snapshot_id:`00000000-0000-4000-8000-${String(p*2+d).padStart(12,'0')}`,snapshot_at:'2026-09-14T01:00:00Z',coverage:{complete:true,expected_count:80000,fetched_count:80000,unique_count:80000},totals:{submitted_count:80000,success_count:channels.reduce((n,_,i)=>n+((i===0)?(d?8000:8500):7000+i*100),0)},groups:channels.map((raw_channel,i)=>({raw_channel,channel_type:'UPI',submitted_count:10000,success_count:i===0?(d?8000:8500):7000+i*100}))})));
const rates=channels.map((thirdParty,i)=>({id:'rate'+i,country:'印度',thirdParty,category:'UPI',sheetName:'合成验收',collectFee:'4.00%',payoutFee:'2.50%',collectSingleFee:'0',payoutSingleFee:'6',collectLimit:'100–50000',payoutLimit:'100–50000',sourceRow:i+2}));
const baselineHeaders=['国家','统一三方','代收金额','代收笔数','代收占比','代付金额','代付笔数','代付占比','合计金额','合计笔数','代收费率','代收手续费','代付费率','代付手续费','合计手续费','手续费占比','总占比','详情'];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1750,height:950},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],network=[];page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{network.push(route.request().url());return route.abort();});
  try {
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}.qa-rail{position:fixed;inset:0 auto 0 0;width:196px;padding:26px 20px;background:#0b1930;color:white;font-size:15px}.qa-rail p{margin:38px 0;color:#a8b7cd;font-size:12px}.qa-shell{margin-left:196px;padding:18px 14px;min-width:0}.qa-note{font-size:12px;color:#62748f;margin:0 0 12px}@media(max-width:760px){.qa-rail{display:none}.qa-shell{margin-left:0;padding:8px}}</style><body><aside class="qa-rail">Hensem 数据后台<p>首页 / 选择模块</p><p>提现 / 自动出款</p><p>工单 / 客服</p><p style="color:#fff">三方量 / 费率</p><p>管理后台</p></aside><main class="qa-shell"><p class="qa-note">正式表格组件验收 · 合成示例数据（非真实统计）</p><div id="app"></div></main><script>${safe(react)}</script><script>${safe(dom)}</script><script>
    const __jsx=React.createElement,__Fragment=React.Fragment,sources=${safe(JSON.stringify(modules))},cache={};
    function require(name){if(name==='react')return React;if(name.endsWith('.css'))return {};const key=name.split('/').pop();if(key==='ThirdPartyRatesDashboard')return {default:()=>null};if(['DashboardAuthGate','dashboardDataClient','monthlyStatusClient'].includes(key))return {};if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unexpected import '+name);const m={exports:{}};cache[key]=m;new Function('require','module','exports','__jsx','__Fragment',sources[key])(require,m,m.exports,__jsx,__Fragment);return m.exports;}
    window.fixture={rows:${safe(JSON.stringify(volumeRows))},snapshots:${safe(JSON.stringify(snapshots))},rates:${safe(JSON.stringify(rates))}};
    const qa=require('./ThirdPartyVolumeDashboard').__qa,helper=require('./collectionSuccess');const app=ReactDOM.createRoot(document.getElementById('app'));
    window.render=(enabled=true,missing=false)=>{const rows=qa.aggregateCombo(window.fixture.rows,r=>[r.country,r.channel]);const feeCombos=qa.aggregateCombo(window.fixture.rows,r=>[r.country,r.platform,r.channel,r.channelType]);const feeRows=qa.buildFeeCompareRows(feeCombos,window.fixture.rates,[],'platform');const view=helper.buildCollectionSuccessView({snapshots:missing?[]:window.fixture.snapshots,volumeRows:window.fixture.rows,start:'${day}',end:'${day}',country:'印度'});app.render(__jsx(qa.MonthlyTable,{title:'印度线下盘口 汇总',subtitle:'',rows,columns:['国家','统一三方'],feeRows,paginated:true,collectionSuccess:enabled?view:undefined}));};window.render(false);
    </script></body></html>`);
    const table=page.locator('.volume-summary-table-wrap > table');
    await table.locator('tbody tr').first().waitFor();
    assert.deepEqual(await table.locator('thead th').allTextContents(),baselineHeaders);
    const original=await table.locator('tbody tr').evaluateAll(rows=>rows.map(r=>[...r.cells].map(c=>c.textContent)));
    await page.evaluate(()=>window.render(true));await page.getByRole('columnheader',{name:'代收成功率',exact:true}).waitFor();
    const headers=await table.locator('thead th').allTextContents();assert.equal(headers.length,19);assert.deepEqual(headers.filter(h=>h!=='代收成功率'),baselineHeaders);assert.equal(headers[4],'代收成功率');
    const after=await table.locator('tbody > tr').evaluateAll(rows=>rows.map(r=>[...r.cells].filter((_,i)=>i!==4).map(c=>c.textContent)));assert.deepEqual(after,original,'all original values and actions must remain unchanged');
    const first=table.locator('tbody > tr').first();assert.match(await first.locator('td').nth(4).innerText(),/85\.00%/);assert.match(await first.locator('td').nth(4).innerText(),/5\.00.*百分点/);assert.equal(await first.locator('td').nth(3).innerText(),'27,003');
    assert.equal(await page.getByText('精简展示',{exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'collection-success-production-table.png'),fullPage:true});
    await first.getByRole('button',{name:'展开',exact:true}).click();
    await table.locator('.volume-child-row').first().waitFor();
    assert.match(await table.innerText(),/91CLUB/);assert.match(await table.innerText(),/55CLUB/);assert.match(await table.innerText(),/IN999/);
    await page.screenshot({path:path.join(output,'collection-success-production-expanded.png'),fullPage:true});
    await first.getByRole('button',{name:'收起',exact:true}).click();
    await page.evaluate(()=>window.render(true,true));
    await page.waitForFunction(()=>document.querySelector('.volume-summary-table-wrap tbody tr td:nth-child(5)').textContent.includes('未采集'));
    assert.doesNotMatch(await table.locator('tbody tr td:nth-child(5)').first().innerText(),/100\.00%|0\.00%/);
    for(const width of [1280,390]) {await page.setViewportSize({width,height:850});const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,table:document.querySelector('.volume-summary-table-wrap').getBoundingClientRect().width}));assert(layout.scroll<=width+1,JSON.stringify(layout));}
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);console.log(JSON.stringify({passed:true,synthetic:true,checks:['actual component 18→19 columns','all original values unchanged','submission denominator separate','same-cell pp delta','real expand platform detail','missing ≠ 0/100','contained horizontal table scroll'],screenshots:['collection-success-production-table.png','collection-success-production-expanded.png'].map(f=>path.join(output,f))},null,2));
  } finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
