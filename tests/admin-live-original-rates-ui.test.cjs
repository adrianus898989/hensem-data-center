const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../admin-preview/live-rates-restored.js'),'utf8');
const window={},context={window};for(const name of ['orders','providers','fetch','XMLHttpRequest','localStorage'])Object.defineProperty(context,name,{get(){throw Error('unexpected '+name)}});
vm.createContext(context);vm.runInContext(code,context);const api=window.HensemLiveRatesRestored;
const sheet=(id,title,index)=>({sheetId:id,title,index,rowCount:30,columnCount:8,frozenRowCount:1,frozenColumnCount:1});
const sheets=[sheet(2,'乙国',1),sheet(1,'甲国',0)];
const rows=[['三方名称','类型 / 钱包','代收合计%+单笔','代付合计%+单笔','总计费率','备注','PLATFORM-A','PLATFORM-B']];
for(let i=0;i<25;i++)rows.push(['TEST-'+String(i).padStart(2,'0'),i%2?'钱包乙':'钱包甲',i===0?'0':'4% + 2/笔',i===1?'0..8%':'2%','6% + 2/笔',i===0?'<img src=x onerror=alert(1)>':'完整原备注',i%2?'暂停':'开启',i%2?'维护':'未接入']);
const grid=id=>({sheet:sheets.find(s=>s.sheetId===id),cells:rows.map(r=>r.map(text=>({text}))),merges:[],rowHeights:[],columnWidths:[],hiddenRows:[],hiddenColumns:[],fetchedAt:'2026-01-01T00:00:00Z',rowCount:rows.length,columnCount:8});
const meta={title:'测试原表',sheets,fetchedAt:'2026-01-01T00:00:00Z'};
(async()=>{
 let requested=[];api.configure({request:async input=>{requested.push(input);return input.sheetId===undefined?meta:grid(input.sheetId)}});
 assert(api.render().includes('<thead>'));assert(api.render().includes('记录 —'));assert(!api.render().includes('TEST-'));
 await api.load();assert.deepEqual(JSON.parse(JSON.stringify(requested)),[{action:'ratesSheet'},{action:'ratesSheet',sheetId:1}]);
 assert.equal(api.model().rows.length,25);assert(api.render().indexOf('>甲国</button>')<api.render().indexOf('>乙国</button>'),'original index order');
 let html=api.render();assert(html.includes('精简展示'));assert(html.includes('原表全部列'));assert(html.includes('PLATFORM-A'));assert(html.includes('代收'));assert(html.includes('合计%+单笔'));assert(html.includes('4% + 2/笔'));assert(!html.includes('<img src=x'));assert.equal((html.match(/<tr data-source-row=/g)||[]).length,20);
 assert(api.model().columns.some(c=>c.label==='代收合计%+单笔'));assert(!api.model().columns.some(c=>c.label==='备注'));
 api.set('view','full');assert(api.model().columns.some(c=>c.label==='总计费率'));assert(api.render().includes('&lt;img'));api.cell(1,5);assert(api.render().includes('原单元格完整内容'));assert(api.render().includes('F2'));
 api.set('query','TEST-00');api.set('type','钱包甲');api.set('platform','6');api.set('status','good');assert.deepEqual([...api.model().rows],[1]);
 api.set('status','paused');assert.equal(api.model().rows.length,0);assert(api.render().includes('没有符合条件的记录'));
 api.reset();api.page(2);assert.equal((api.render().match(/<tr data-source-row=/g)||[]).length,5);api.page(1,30);assert.equal((api.render().match(/<tr data-source-row=/g)||[]).length,25);
 api.set('query','TEST-00');await api.selectSheet(2);assert.equal(api.snapshot().query,'');assert.equal(api.snapshot().sheetId,2);
 // The inherited source-coordinate model resolves merged cells and never fills
 // unrelated blanks, preserving zero, complex fee strings and duplicate names.
 const merged=grid(1);merged.cells[2][0].text='';merged.merges=[{startRowIndex:1,endRowIndex:3,startColumnIndex:0,endColumnIndex:1}];
 assert.equal(api.sourceTools.tidySourceCell(merged,2,0).text,'TEST-00');assert.equal(api.sourceTools.tidySourceCell(merged,3,0).text,'TEST-02');assert.equal(api.sourceTools.tidySourceCell(merged,1,2).text,'0');assert.equal(api.sourceTools.tidySourceCell(merged,2,3).text,'0..8%');
 const snapshot=JSON.stringify(merged);api.sourceTools.buildTidyModel(merged);assert.equal(JSON.stringify(merged),snapshot);
 // Out-of-order sheet responses cannot replace the user's newer selection.
 let resolveOld;api.configure({request:async input=>input.sheetId===undefined?meta:input.sheetId===1?new Promise(resolve=>{resolveOld=resolve}):grid(2)});
 const pending=api.load();await new Promise(resolve=>setImmediate(resolve));await api.selectSheet(2);resolveOld(grid(1));await pending;assert.equal(api.snapshot().sheetId,2);assert.equal(api.snapshot().hasGrid,true);
 // Revocation/network error clears every cached source value, retaining headers.
 api.configure({request:async()=>{throw Error('当前账号没有原表查看权限')}});await api.load();html=api.render();assert(html.includes('<thead>'));assert(html.includes('当前账号没有原表查看权限'));assert(!html.includes('TEST-'));assert(!html.includes('甲国'));assert.equal(api.snapshot().hasGrid,false);
 let fallback=false;api.configure({onUnavailable:()=>fallback=true});api.unavailable();assert(fallback);api.clear();assert(!api.snapshot().hasGrid);
 assert.doesNotMatch(code,/\b(?:fetch|XMLHttpRequest)\s*\(|localStorage|service_role|createClient\s*\(/);
 console.log('PASS: original model/CSS, source-order tabs, AND filters, full/compact matrix, safe exact text, paging, merge anchors, stale-response guard, denied empty header.');
})().catch(error=>{console.error(error);process.exitCode=1});
