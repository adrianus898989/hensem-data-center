/* Actual React workspace + parent, synthetic Google-shaped data, zero network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || '/Users/jun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'outputs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const safe = value => value.replace(/<\/script/gi, '<\\/script');
const files = ['components/ThirdPartyRatesDashboard.tsx','components/ThirdPartyRateSheet.tsx','components/OriginalRatesWorkspace.tsx','components/OriginalRateGrid.tsx','lib/dashboardDataScope.ts','lib/thirdPartyNameMap.ts','lib/platformDisplayCountry.ts','lib/format.ts'];
const modules = Object.fromEntries(files.map(file => [path.basename(file).replace(/\.tsx?$/, ''), ts.transpileModule(read('src/'+file), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,jsxFactory:'__jsx',jsxFragmentFactory:'__Fragment'}}).outputText]));
const css = ['app/globals.css','components/ThirdPartyRatesDashboard.css','components/ThirdPartyRateSheet.css','components/OriginalRatesWorkspace.css','components/OriginalRateGrid.css'].map(file => read('src/'+file)).join('\n');
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const dom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const longText = '离线原文：第一行 保留  两个空格\n第二行 🙂 <img src=x onerror=alert(1)>\n'+ '说明完整保留；'.repeat(70)+'全文结尾标记';
function sheet(sheetId,title,index) {return {sheetId,title,index,rowCount:12,columnCount:10,frozenRowCount:2,frozenColumnCount:2};}
const sheets = [sheet(277747449,'印度原表 · 合成',0),sheet(202,'越南原表 · 合成',1),sheet(303,'巴西原表 · 合成',2)];
function gridFor(meta) {
  const cells = Array.from({length:12}, (_,r)=>Array.from({length:10},(_,c)=>({text:r===0 ? (c===0?'合成来源原表 · 非生产费率':'') : r===1 ? ['原行','三方','类型','代收启用','代付启用','代收费率','代付费率','备注','隐藏列','平台甲'][c] : c===0?String(r+1):c===1?'样本三方 '+r:c===2?'原始类型':c===3?'开启':c===4?'备用':c===5?'0%':c===6?'1.25%':c===9?'未接入':'',format:{backgroundColor:r<2?{red:.86,green:.92,blue:.98}:c===3?{red:.9,green:1,blue:.91}:{red:1,green:1,blue:1},textFormat:{fontSize:10,bold:r<2},wrapStrategy:'WRAP',verticalAlignment:'MIDDLE'}})));
  cells[2][7]={text:longText,format:{wrapStrategy:'WRAP'}};cells[3][7]={text:'needle 第二个匹配'};cells[2][2]={text:'needle 第一个匹配'};
  cells[8][7]={text:'needle 隐藏行不算'};cells[4][8]={text:'needle 隐藏列不算'};cells[11][9]={text:'末端可定位'};
  cells[2][1]={text:'合并三方原名',format:{backgroundColor:{red:1,green:.96,blue:.77},verticalAlignment:'MIDDLE'}};
  return {sheet:meta,cells,merges:[{startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:3},{startRowIndex:2,endRowIndex:6,startColumnIndex:1,endColumnIndex:2}],rowHeights:Array.from({length:12},(_,i)=>i<2?32:40),columnWidths:[58,142,112,100,100,100,100,238,80,128],hiddenRows:[8],hiddenColumns:[8],fetchedAt:'2026-09-14T08:00:00Z',rowCount:12,columnCount:10};
}
const grids=Object.fromEntries(sheets.map(meta=>[meta.sheetId,gridFor(meta)])),meta={title:'离线原表样本',sheets,fetchedAt:'2026-09-14T08:00:00Z'};
const profiles={all:{auth_user_id:'synthetic-all',role:'viewer',active:true,permissions:{third_party:true},data_scope:{mode:'all',countries:[]},updated_at:'a'},restricted:{auth_user_id:'synthetic-restricted',role:'viewer',active:true,permissions:{third_party:true},data_scope:{mode:'selected',countries:['BR_PANGHU']},updated_at:'b'}};
const tick=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function run(){
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(4000);
  const errors=[],network=[],results=[],screenshots=[];
  page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{network.push(route.request().url());return route.abort();});
  const html=String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#f2f5fa}.fixture-shell{padding:12px;min-width:0}.fixture-note{font:12px Arial,sans-serif;color:#53657c;margin:0 0 8px}.original-rate-grid{--original-rate-grid-height:620px}</style><body><main class="fixture-shell"><p class="fixture-note">离线 UI 验收 · 合成 Google 数据 · 不代表实时费率</p><div id="app"></div></main><script>${safe(react)}</script><script>${safe(dom)}</script><script>
  const __jsx=React.createElement,__Fragment=React.Fragment,sources=${safe(JSON.stringify(modules))},cache={};
  window.fixture={meta:${safe(JSON.stringify(meta))},grids:${safe(JSON.stringify(grids))}};window.calls=[];window.storageReads=0;window.sideEffects=0;window.currentProfile=null;window.options={};
  Object.defineProperty(window,'localStorage',{configurable:true,get(){window.storageReads++;throw Error('Local storage forbidden in this test');}});
  window.alert=window.open=()=>{window.sideEffects++;};window.fetch=()=>{throw Error('Native fetch forbidden in offline UI test');};
  function request(url,init={}){
    const record={id:window.calls.length,url,signal:init.signal,aborted:false,done:false};window.calls.push(record);if(init.signal)init.signal.addEventListener('abort',()=>{record.aborted=true;});
    if(url==='/api/supabase-third-party-rates'){record.done=true;return Promise.resolve({ok:true,json:async()=>({rates:[],platformStatuses:[],anomalies:[],meta:{sheets:[],updatedAt:'2026-09-14T08:00:00Z'},summary:{totalRates:0,totalPlatforms:0}})});}
    if(!/^\/api\/original-rate-sheet(?:\?sheetId=\d+)?$/.test(url))throw Error('Unexpected API '+url);
    const id=new URL(url,'https://offline.invalid').searchParams.get('sheetId');
    return new Promise((resolve,reject)=>{
      record.deliver=(value,status=200)=>{record.done=true;resolve({ok:status===200,status,json:async()=>structuredClone(value)});};
      record.reject=()=>{record.done=true;reject(Object.assign(Error('synthetic denied'),{denied:true}));};
      if(id===null&&!window.options.holdMeta)record.deliver(window.fixture.meta);
      if(id!==null&&!window.options.holdGrid)record.deliver(window.fixture.grids[id]);
    });
  }
  function require(name){if(name==='react')return React;if(name.endsWith('.css'))return {};const key=name.split('/').pop();
    if(key==='DashboardAuthGate')return {useDashboardAuth:()=>({profile:window.currentProfile,session:{access_token:'OFFLINE_'+window.currentProfile?.auth_user_id}})};
    if(key==='dashboardDataClient')return {dashboardBusinessFetch:request,isDashboardDataDenied:e=>e?.denied===true};
    if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unexpected module '+name);const m={exports:{}};cache[key]=m;new Function('require','module','exports','__jsx','__Fragment',sources[key])(require,m,m.exports,__jsx,__Fragment);return m.exports;}
  const app=ReactDOM.createRoot(document.getElementById('app'));window.parentKey=0;
  window.mount=(profile,options={},fresh=true)=>{window.currentProfile=profile;window.options=options;if(fresh)window.parentKey++;app.render(React.createElement(require('./ThirdPartyRatesDashboard').default,{key:window.parentKey,embedded:true}));};
  window.pending=()=>window.calls.filter(r=>!r.done&&!r.aborted).map(r=>({id:r.id,url:r.url}));
  window.deliver=(id,value,status)=>window.calls[id].deliver(value,status);window.rejectCall=id=>window.calls[id].reject();
  </script></body></html>`;
  const calls=()=>page.evaluate(()=>window.calls.map(r=>({id:r.id,url:r.url,aborted:r.aborted,done:r.done})));
  const mount=async(profile=profiles.all,options={},fresh=true)=>{await page.evaluate(v=>window.mount(v.profile,v.options,v.fresh),{profile,options,fresh});await tick(page);};
  const ready=async(id=277747449)=>page.locator(`.original-rate-grid[data-sheet-id="${id}"]`).waitFor();
  const pending=async(pattern)=>{await page.waitForFunction(pattern=>window.pending().some(r=>r.url===pattern),pattern);return (await page.evaluate(()=>window.pending())).find(r=>r.url===pattern).id;};
  const deliver=async(id,value,status=200)=>{await page.evaluate(v=>window.deliver(v.id,v.value,v.status),{id,value,status});await tick(page);};
  const check=async(name,fn)=>{try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.log('FAIL '+name+' '+e.message);}};
  try{
    await page.setContent(html);assert.deepEqual(errors,[],'Browser harness must initialize without errors');
    await check('actual parent all-data opens source workspace; source order and text preserved',async()=>{
      await mount();await ready();assert.deepEqual(await page.locator('.original-rates-tabs button').allTextContents(),sheets.map(s=>s.title));
      assert.equal(await page.locator('[data-cell="A1"]').getAttribute('colspan'),'3');assert.equal(await page.locator('[data-cell="B3"]').getAttribute('rowspan'),'4');
      assert.equal(await page.locator('[data-cell="F3"]').textContent(),'0%');assert.equal(await page.locator('[data-cell="I5"]').count(),0);assert.equal(await page.locator('[data-cell="H9"]').count(),0);
      assert.deepEqual(await page.evaluate(()=>window.fixture),{meta,grids});
    });
    await check('complete multiline cell content remains inline and inert',async()=>{
      await page.locator('[data-cell="H3"]').click();assert.equal(await page.getByLabel('原单元格完整内容').inputValue(),longText);
      const content=page.getByLabel('原单元格完整内容');await content.focus();assert((await content.boundingBox()).height>=60);
      assert(await content.evaluate(node=>node.readOnly&&(node.scrollHeight>node.clientHeight||node.scrollWidth>node.clientWidth)));await content.evaluate(node=>{node.scrollTop=node.scrollHeight;node.scrollLeft=node.scrollWidth;});assert(await content.evaluate(node=>node.scrollTop>0||node.scrollLeft>0));
      assert.equal(await page.locator('[role="dialog"],dialog,.original-rate-grid img').count(),0);assert.equal(await page.evaluate(()=>window.sideEffects),0);
    });
    await check('search uses visible original cells, cycles matches and locates merged source coordinates',async()=>{
      await page.getByLabel('在原表中查找').fill('needle');await page.getByRole('button',{name:'查找',exact:true}).click();
      assert.equal(await page.getByLabel('单元格位置').inputValue(),'C3');assert.equal(await page.locator('.original-rates-search [aria-live]').textContent(),'1/2');
      await page.getByRole('button',{name:'查找',exact:true}).click();assert.equal(await page.getByLabel('单元格位置').inputValue(),'H4');
      await page.getByLabel('单元格位置').fill('B5');await page.getByLabel('单元格位置').press('Enter');assert.equal(await page.getByLabel('单元格位置').inputValue(),'B3');
      assert.equal(await page.locator('[data-cell="B3"]').getAttribute('data-selected'),'true');
      await page.getByLabel('单元格位置').fill('J12');await page.getByLabel('单元格位置').press('Enter');assert.equal(await page.getByLabel('原单元格完整内容').inputValue(),'末端可定位');
    });
    await check('sheet switch aborts old request and ignores even a late fulfilled result',async()=>{
      await mount(profiles.all,{holdGrid:true});const old=await pending('/api/original-rate-sheet?sheetId=277747449');
      await page.getByRole('button',{name:sheets[1].title,exact:true}).click();const next=await pending('/api/original-rate-sheet?sheetId=202');
      assert.equal((await calls()).find(r=>r.id===old).aborted,true);await deliver(next,grids[202]);await ready(202);await deliver(old,grids[277747449]);
      assert.equal(await page.locator('.original-rate-grid').getAttribute('data-sheet-id'),'202');
    });
    await check('refresh preserves current sheet instead of resetting to default',async()=>{
      await mount();await ready();await page.getByRole('button',{name:sheets[1].title,exact:true}).click();await ready(202);
      await page.getByRole('button',{name:'刷新',exact:true}).click();await tick(page);await ready(202);
      assert.equal(await page.locator('.original-rates-tabs [aria-current]').textContent(),sheets[1].title);
    });
    await check('metadata retry enters pending state and cannot be duplicated while loading',async()=>{
      await mount(profiles.all,{holdMeta:true});const id=await pending('/api/original-rate-sheet');await deliver(id,{message:'离线模拟不可用'},503);
      await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'重试',exact:true}).click();await tick(page);
      await page.getByRole('status').waitFor({timeout:1200});assert.equal(await page.getByRole('button',{name:'刷新',exact:true}).isDisabled(),true);
      assert.equal((await page.evaluate(()=>window.pending())).filter(r=>r.url==='/api/original-rate-sheet').length,1);
    });
    await check('refresh waits for successful metadata before reading a grid, including after failure',async()=>{
      await mount();await ready();await page.getByRole('button',{name:sheets[1].title,exact:true}).click();await ready(202);
      const before=(await calls()).length;await page.evaluate(()=>{window.options={holdMeta:true,holdGrid:true};});await page.getByRole('button',{name:'刷新',exact:true}).click();
      const first=await pending('/api/original-rate-sheet');await tick(page);assert.equal(await page.locator('[data-cell]').count(),0);
      assert.equal((await calls()).slice(before).filter(r=>r.url.includes('?sheetId=')).length,0);
      await deliver(first,{message:'模拟元数据失败'},503);await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-cell]').count(),0);
      await page.getByRole('button',{name:'重试',exact:true}).click();const next=await pending('/api/original-rate-sheet');await deliver(next,meta);
      const nextGrid=await pending('/api/original-rate-sheet?sheetId=202');await deliver(nextGrid,grids[202]);await ready(202);
      assert.equal((await calls()).slice(before).filter(r=>r.url.includes('?sheetId=')).length,1);
    });
    await check('profile identity change remounts and aborts former all-data content',async()=>{
      await mount(profiles.all,{holdGrid:true});const old=await pending('/api/original-rate-sheet?sheetId=277747449');
      const nextProfile={...profiles.all,auth_user_id:'synthetic-other',updated_at:'next'};await mount(nextProfile,{holdGrid:true},false);
      const next=await pending('/api/original-rate-sheet?sheetId=277747449');assert.notEqual(next,old);assert.equal((await calls()).find(r=>r.id===old).aborted,true);
      const another=structuredClone(grids[277747449]);another.cells[2][2]={text:'新账号独立内容'};
      await deliver(next,another);await ready();await deliver(old,grids[277747449]);assert.equal(await page.locator('[data-cell="C3"]').textContent(),'新账号独立内容');
    });
    await check('selected scope stays on existing limited page; downgrade does not retain source cells',async()=>{
      const before=(await calls()).filter(r=>r.url.startsWith('/api/original-rate-sheet')).length;await mount(profiles.restricted,{},false);
      assert.equal(await page.locator('.original-rates-workspace').count(),0);assert.equal(await page.locator('[data-cell]').count(),0);
      assert.equal((await calls()).filter(r=>r.url.startsWith('/api/original-rate-sheet')).length,before);
      assert.equal(await page.locator('.third-party-module').count(),1);
      await mount({...profiles.restricted,data_scope:{mode:'selected',countries:[]}},{});assert.equal(await page.locator('.original-rates-workspace').count(),0);
    });
    await check('source permission error removes old grid and offers no stale fallback',async()=>{
      await mount();await ready();await page.evaluate(()=>{window.options={holdGrid:true};});await page.getByRole('button',{name:sheets[1].title,exact:true}).click();
      const id=await pending('/api/original-rate-sheet?sheetId=202');await page.evaluate(id=>window.rejectCall(id),id);await page.getByRole('alert').waitFor();
      assert.equal(await page.locator('[data-cell]').count(),0);assert.match(await page.getByRole('alert').textContent(),/权限/);
    });
    await check('anomaly action unmounts source view and leaves existing dashboard',async()=>{
      await mount();await ready();await page.getByRole('button',{name:'异常提醒',exact:true}).click();assert.equal(await page.locator('.original-rates-workspace').count(),0);assert.equal(await page.locator('.third-party-module').count(),1);
    });
    await mount();await ready();await page.locator('[data-cell="H3"]').click();
    await page.getByLabel('原单元格完整内容').focus();await page.getByLabel('原单元格完整内容').evaluate(node=>{node.setSelectionRange(0,0);node.scrollTop=0;node.scrollLeft=0;});
    for(const width of [1280,390]){await page.setViewportSize({width,height:900});await tick(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Only table may scroll horizontally');const screenshot=path.join(output,`original-rates-workspace-${width}.png`);await page.screenshot({path:screenshot,fullPage:true});screenshots.push(screenshot);}
    await check('no local storage, popup, browser error or external request',async()=>{assert.equal(await page.evaluate(()=>window.storageReads),0);assert.equal(await page.evaluate(()=>window.sideEffects),0);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
    const report={passed:results.every(r=>r.passed),actualReact:true,syntheticOnly:true,externalRequests:network.length,pageErrors:errors,checks:results,screenshots};
    fs.writeFileSync(path.join(output,'original-rates-workspace-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
  }finally{await context.close();await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
