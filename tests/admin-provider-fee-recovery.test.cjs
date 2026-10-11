// Production renderers and framed request bridge; only synthetic local data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
const navShared=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,settle,aggregate}=new Function('require','__dirname',navShared+';return {ready,settle,aggregate};')(require,__dirname);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const plain=s=>String(s).replace(/<[^>]*>/g,'').trim();
const native=(direction='charge',extra={})=>order('synthetic-platform','ar',1000,10,{country:'印度',platform:'Synthetic',provider:'SyntheticPay',direction,...extra});
const history=(row,amount)=>({...row,fee_version_estimated_amount:amount,fee_version_matched_count:row.success_count,fee_version_unmatched_count:0,fee_version_state:'complete'});
function setup(direction='charge',rows=[history(native(direction),17.25)]){
 const h=fixture(rows);h.L.feeLookupRows=[];h.L.feeLookupError='Synthetic timeout <unsafe>';h.L.feeEstimateMode='current';h.render(direction);return h;
}
function grid(html){
 const head=html.match(/<thead>([\s\S]*?)<\/thead>/)[1],headers=[...head.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(x=>plain(x[1]).replace(/ [↕↑↓]$/,''));
 const parse=part=>[...html.match(new RegExp('<'+part+'>([\\s\\S]*?)</'+part+'>'))[1].matchAll(/<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g)].map(x=>({kind:x[1]||'',cells:[...x[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1])}));
 return {body:parse('tbody'),footer:parse('tfoot'),value:(row,key)=>plain(row.cells[headers.indexOf(key)])};
}
const feeCard=html=>html.match(/<div class="provider-kpi provider-kpi-fee"[\s\S]*?<\/div><\/div>/)?.[0]||'';
test('both provider directions expose escaped fee retry without inventing a current amount',()=>{
 for(const direction of ['charge','withdraw']){
  const h=setup(direction),d=grid(h.html());assert.equal(d.value(d.body[0],'估算手续费'),'读取失败');
  assert.match(h.html(),/<button[^>]*aria-label="重试读取费率"[^>]*onclick="liveRetryFeeLookup\(\)"[^>]*>重试费率<\/button>/);
  assert.match(h.html(),/title="Synthetic timeout &lt;unsafe&gt;"/);assert.doesNotMatch(h.html(),/<unsafe>/);
  h.L.feeLookupLoading=true;h.render(direction);assert.match(h.html(),/<button[^>]*aria-label="重试读取费率"[^>]*disabled[^>]*>/);
  h.L.feeLookupLoading=false;h.L.feeLookupError='';h.render(direction);assert.doesNotMatch(h.html(),/重试读取费率/);
 }
});
test('historical parent, platform child and footer retain real fees while the current directory fails or loads',()=>{
 for(const direction of ['charge','withdraw'])for(const loading of [false,true]){
  const h=setup(direction);h.L.feeLookupLoading=loading;h.root.providerSummaryFeeMode('historical');
  h.root.providerSummaryToggle(0);const d=grid(h.html()),parent=d.body.find(r=>!r.kind),child=d.body.find(r=>r.kind==='provider-platform-row');assert(child);
  assert.equal(d.value(parent,'估算手续费'),'17.25');assert.equal(d.value(child,'估算手续费'),'17.25');assert.equal(d.value(d.footer.at(-1),'估算手续费'),'17.25');
  assert.doesNotMatch(feeCard(h.html()),/费率读取失败|费率读取中/);assert.equal(h.networkCalls(),0);
  h.root.providerSummaryFeeMode('current');const current=grid(h.html());assert.equal(current.value(current.body.find(r=>!r.kind),'估算手续费'),loading?'读取中…':'读取失败');
 }
});
test('historical missing and zero amounts remain distinct despite a current directory error',()=>{
 for(const amount of [null,0]){
  const row=amount===null?{...native(),fee_version_estimated_amount:null,fee_version_matched_count:0,fee_version_unmatched_count:10,fee_version_state:'unknown'}:history(native(),0);
  const h=setup('charge',[row]);h.root.providerSummaryFeeMode('historical');const d=grid(h.html()),value=d.value(d.body[0],'估算手续费');
  if(amount===null){assert.match(value,/^—/);assert.doesNotMatch(value,/读取失败|0\.00/)}else assert.equal(value,'0.00');
  assert.doesNotMatch(feeCard(h.html()),/费率读取失败|费率读取中/);
 }
});
test('historical two-period fee comparison uses stored fees independently of the current directory',()=>{
 for(const direction of ['charge','withdraw']){
  const current=history(native(direction),17.25),previous=history(native(direction,{success_amount:500,success_count:5}),8.625),h=setup(direction,[current]);
  const p={id:'synthetic-platform',name:'Synthetic',source:'ar',country:'印度',currency:'INR',timezone:'Asia/Kolkata'};
  h.L.queryPlatforms=[p];h.L.results=[{platform:p,groups:{provider:[current]}}];h.L.comparisonResults=[{platform:p,groups:{provider:[previous]}}];h.L.comparisonStatus='ready';
  h.root.providerSummaryFeeMode('historical');const card=feeCard(h.html());assert.match(card,/>17\.25</);assert.match(card,/昨日 8\.63/);assert.match(card,/100\.00%/);assert.doesNotMatch(card,/费率读取失败|费率读取中/);
 }
});
test('the actual retry button deduplicates reads, refreshes current fees and keeps business statistics',async()=>{
 const h=await ready();await h.c.liveQuery();await settle();h.c.setPage('providers');await h.c.liveQuery();await settle();
 h.L.feeLookupRows=[];h.L.feeLookupError='Synthetic read error';h.L.feeLookupLoading=false;h.c.render();
 const button=h.html().match(/<button[^>]*aria-label="重试读取费率"[^>]*onclick="([^"]*)"[^>]*>/);assert(button);
 const pending=deferred();h.setHandler(q=>q.action==='rates'?pending.promise:aggregate());
 const business=h.L.results,before=h.calls.length,first=vm.runInContext(button[1],h.c);await vm.runInContext(button[1],h.c);
 assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).action,'rates');assert.equal(h.calls.at(-1).offset,0);assert.equal(h.L.feeLookupLoading,true);assert.equal(h.L.results,business);
 pending.resolve({rows:[{id:'synthetic-rate',scopeType:'country',country:'印度',provider:'SyntheticPay',collectFee:'4%'}],total:1});await first;await settle();
 assert.equal(h.L.feeLookupError,'');assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.feeLookupRows[0].id,'synthetic-rate');assert.equal(h.L.results,business);assert.doesNotMatch(h.html(),/重试读取费率/);
 h.c.setPage('ip');const after=h.calls.length;await vm.runInContext(button[1],h.c);assert.equal(h.calls.length,after,'an old button cannot fetch on an unrelated page');
});
test('retry button cannot bypass provider view permissions',async()=>{
 let allowed=true;const h=await ready({roleAllowed:(page,permission)=>permission!=='view'||allowed});
 await h.c.liveQuery();await settle();h.c.setPage('providers');await h.c.liveQuery();await settle();
 h.L.feeLookupRows=[];h.L.feeLookupError='Synthetic read error';h.c.render();const button=h.html().match(/aria-label="重试读取费率"[^>]*onclick="([^"]*)"/);assert(button);
 allowed=false;const before=h.calls.length;await vm.runInContext(button[1],h.c);assert.equal(h.calls.length,before);
});
