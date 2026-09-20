// Production React table + styles in an isolated browser, synthetic data only.
// All external requests are blocked; no account, server or database is used.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),modules={};
for(const dir of ['src/lib','src/components'])for(const file of fs.readdirSync(path.join(root,dir))){
  if(!/\.tsx?$/.test(file))continue;
  const key=file.replace(/\.tsx?$/,'');let source=fs.readFileSync(path.join(root,dir,file),'utf8');
  if(key==='ThirdPartyVolumeDashboard')source+='\nexport const __sortingTest={MonthlyTable,aggregateCombo};';
  modules[key]=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
    jsx:ts.JsxEmit.React,jsxFactory:'__jsx',jsxFragmentFactory:'__Fragment'}}).outputText;
}
const react=fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')),'umd/react.development.js'),'utf8');
const dom=fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js'),'utf8');
const css=['src/app/globals.css',...fs.readdirSync(path.join(root,'src/components')).filter(n=>n.endsWith('.css')).map(n=>'src/components/'+n)]
  .map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const safe=text=>text.replace(/<\/script/gi,'<\\/script');
const fixtureHtml=`<!doctype html><meta charset="utf-8"><style>${css}
      body{margin:0;padding:20px;background:#f3f6fa}#app{max-width:1460px}
      </style><div id="app"></div><script>${safe(react)}</script><script>${safe(dom)}</script><script>
      const __jsx=React.createElement,__Fragment=React.Fragment,sources=${safe(JSON.stringify(modules))},cache={};
      function require(name){
        if(name==='react')return React;if(name.endsWith('.css'))return {};
        const key=name.split('/').pop();
        if(key==='DashboardAuthGate')return {useDashboardAuth:()=>({session:null,profile:null})};
        if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unknown fixture module '+name);
        const module={exports:{}};cache[key]=module;
        new Function('require','module','exports','__jsx','__Fragment','process',sources[key])
          (require,module,module.exports,__jsx,__Fragment,{env:{}});return module.exports;
      }
      const {MonthlyTable,aggregateCombo}=require('./ThirdPartyVolumeDashboard').__sortingTest;
      const raw=[['Small',20],['Large',100],['Zero',0],['Unknown',NaN],['Same',20]].flatMap(([channel,amount],index)=>
        ['代收','代付'].map(direction=>({id:channel+direction,country:'红膏蟹',platform:'66GAME',channel,rawChannel:channel,
          channelType:'BANK',date:'2026-09-01',direction,amount,count:index+1})));
      let rows=aggregateCombo(raw,row=>[row.country,row.channel]);
      const root=ReactDOM.createRoot(document.getElementById('app'));
      window.redraw=(reverse=false)=>root.render(__jsx('div',{className:'third-party-volume-module'},__jsx(MonthlyTable,
        {title:'排序验收',subtitle:'',rows:reverse?[...rows].reverse():rows,columns:['统一三方'],columnIndexes:[1],stickyFirstColumn:true,paginated:true})));
      window.redraw();
      </script>`;
(async()=>{
  if(process.env.FIXTURE_PORT){
    const http=require('node:http');
    http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:"});res.end(fixtureHtml);}).listen(Number(process.env.FIXTURE_PORT),'127.0.0.1',()=>console.log('Synthetic sorting preview ready'));
    return;
  }
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1500,height:760},serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{external.push(route.request().url());return route.abort();});
  try{
    await page.setContent(fixtureHtml);
    await page.locator('tbody tr').first().waitFor();
    const names=()=>page.locator('tbody tr > td:first-child').allTextContents();
    assert.deepEqual(await names(),['Large','Same','Small','Zero','Unknown']);
    assert.equal(await page.getByRole('columnheader',{name:'合计金额',exact:true}).getAttribute('aria-sort'),'descending');
    const amount=page.getByRole('columnheader',{name:'代收金额',exact:true});
    await amount.getByRole('button').click();assert.equal(await amount.getAttribute('aria-sort'),'descending');
    await amount.getByRole('button').click();assert.equal(await amount.getAttribute('aria-sort'),'ascending');
    assert.deepEqual(await names(),['Zero','Same','Small','Large','Unknown']);
    await page.evaluate(()=>window.redraw(true));
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr')[1].children[0].textContent==='Small');
    assert.deepEqual(await names(),['Zero','Small','Same','Large','Unknown'],'sorting survives result refresh');
    const geometry=await page.locator('thead .th-sort-btn').evaluateAll(buttons=>buttons.map(button=>{
      const label=button.firstElementChild.getBoundingClientRect(),arrow=button.lastElementChild.getBoundingClientRect();
      const th=button.closest('th'),style=getComputedStyle(th);
      return {label:button.firstElementChild.textContent,gap:arrow.left-label.right,
        textAlign:style.textAlign,numeric:th.classList.contains('num'),arrow:button.lastElementChild.textContent};
    }));
    assert(geometry.every(g=>g.gap>=0&&g.gap<=4),'every arrow sits next to its label');
    assert(geometry.filter(g=>g.numeric).every(g=>g.textAlign==='right'),'numeric headers are right aligned');
    assert.equal(geometry.filter(g=>g.arrow!=='↕').length,1,'only current sort has direction arrow');
    const sticky=page.locator('thead th').first(),before=await sticky.boundingBox();
    await page.locator('.volume-summary-table-wrap').evaluate(el=>{el.scrollLeft=450;});
    const after=await sticky.boundingBox();assert(Math.abs(before.x-after.x)<1,'provider stays pinned while scrolling');
    const dir=path.join(root,'outputs');fs.mkdirSync(dir,{recursive:true});
    await page.screenshot({path:path.join(dir,'order-time-sort-compact.png'),fullPage:true});
    await page.setViewportSize({width:390,height:760});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile table scroll stays contained');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(JSON.stringify({passed:true,externalRequests:0,geometry,screenshot:path.join(dir,'order-time-sort-compact.png')}));
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
