const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/lib/tidyOriginalRates.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const direct={};new Function('exports',compiled)(direct);
const restored=fs.readFileSync(path.join(root,'admin-preview/live-rates-restored.js'),'utf8');
const definitions=[['开启 🟢','运行中'],['不支持 ❌','盘口不支持接入'],['暂时停 ⚠️','暂时停用'],['备用 🟡','三方都正常的情况下不开'],['未接入 ⭕','盘口没有接入这个三方'],['维护 ⚒','三方维护']];
function grid(title='尼日利亚盘口'){
 const rows=Array.from({length:7},()=>Array(19).fill(''));
 Object.assign(rows[0],{0:'三方',1:'代收费率',2:'状态',3:'状态备注内容',15:'FB999',17:'状态',18:'状态备注内容'});
 Object.assign(rows[1],{0:'PAY-A',1:'1.5%',2:'开启',3:'确认已接入',15:'开启'});
 Object.assign(rows[2],{0:'PAY-B',1:'0',2:'维护',3:'维护至明天',15:'未接入'});
 definitions.forEach((pair,i)=>{rows[i+1][17]=pair[0];rows[i+1][18]=pair[1];});
 return {sheet:{sheetId:1,title,index:0,rowCount:7,columnCount:19},rowCount:7,columnCount:19,
  cells:rows.map(row=>row.map(text=>({text}))),merges:[],hiddenRows:[],hiddenColumns:[],rowHeights:[],columnWidths:[],fetchedAt:'2026-11-18T08:00:00Z'};
}
function client(){const window={};vm.runInNewContext(restored,{window});return window.HensemLiveRatesRestored;}

test('formal and restored rate models remove only the six-definition legend without changing source or business statuses',()=>{
 const api=client(),input=grid(),before=JSON.stringify(input);
 assert(restored.includes(compiled),'the embedded model exactly matches its TypeScript source');
 for(const tools of [direct,api.sourceTools]){
  const m=tools.buildTidyModel(input);
  assert.deepEqual(Array.from(m.rows),[1,2]);
  assert.deepEqual(Array.from(m.columns,c=>c.sourceColumn),Array.from({length:17},(_,i)=>i));
  assert(m.columns.some(c=>c.sourceColumn===2&&c.kind==='status'));
  assert(m.platformColumns.includes(15));
  const p=m.columns.find(c=>c.sourceColumn===15);
  assert.equal(tools.tidyBodySourceCell(input,1,p,m.headerRows).text,'开启');
  assert.equal(JSON.stringify(input),before);
 }
});

test('status headers alone, an ordinary business note or additional data never cause column removal',()=>{
 for(const change of [
  g=>{g.cells[0][18].text='业务备注';},
  g=>{g.cells[3][18].text='本三方只暂停代付';},
  g=>{for(let row=2;row<7;row++){g.cells[row][17].text='';g.cells[row][18].text='';}},
  g=>{g.cells.push(Array.from({length:19},(_,i)=>({text:i===17?'自定义业务状态':i===18?'须保留':''})));g.rowCount++;g.sheet.rowCount++;}
 ]){
  const input=grid();change(input);const model=direct.buildTidyModel(input);
  assert(model.columns.some(c=>c.sourceColumn===17));assert(model.columns.some(c=>c.sourceColumn===18));
 }
});

test('country tabs, both display modes, search and the rendered export table share the legend-free business rows',async()=>{
 const api=client(),sheets=[grid('尼日利亚盘口'),grid('菲律宾盘口')];sheets[1].sheet.sheetId=2;sheets[1].sheet.index=1;
 const meta={title:'费率表',sheets:sheets.map(g=>g.sheet),fetchedAt:sheets[0].fetchedAt};
 api.configure({request:async q=>q.sheetId===undefined?meta:sheets.find(g=>g.sheet.sheetId===q.sheetId)});
 for(const input of sheets){
  if(input.sheet.sheetId===2)await api.selectSheet(2);await api.load();
  for(const view of ['compact','full']){
   api.set('view',view);const m=api.model();assert.equal(m.rows.length,2);
   assert(!m.columns.some(c=>c.sourceColumn===17||c.sourceColumn===18));
   const html=api.render(),table=html.match(/<table\b[\s\S]*?<\/table>/)?.[0];assert(table);
   assert.match(table,/FB999/);assert.match(table,/PAY-A/);assert.match(table,/开启/);
   for(const [,note] of definitions)assert(!table.includes(note));
   api.set('query','盘口不支持接入');assert.equal(api.model().rows.length,0);
   api.set('query','PAY-A');assert.deepEqual(Array.from(api.model().rows),[1]);
   api.set('query','');api.set('platform','15');api.set('status','good');assert.deepEqual(Array.from(api.model().rows),[1]);
   api.reset();
  }
 }
 api.clear();
});
