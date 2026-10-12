const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))};
const rows=n=>Array.from({length:n},(_,i)=>({reason:'规则 '+i,reasonKey:i.toString(16).padStart(32,'0'),categoryKey:i.toString(16).padStart(32,'0'),count:1}));
function fixture(){
 let now=1000,resolve,reject,html='',body={scrollTop:300,scrollLeft:40};const requests=[],paints=[];
 const host={querySelector:()=>body};Object.defineProperty(host,'innerHTML',{get:()=>html,set:value=>{html=value;paints.push(value);body={scrollTop:0,scrollLeft:0}}});
 const ctx={Date:class extends Date{static now(){return now}},Intl,document:{getElementById:id=>id==='withdraw-reason-overlay'?host:null,querySelector:()=>null},HensemLiveFilters:{multi:()=>''}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 const L={catalogReady:true,catalog:[{country:'巴西',name:'SYNTHETIC'}],country:'巴西',from:'2026-10-11T00:00:00',to:'2026-10-11T23:59:59'};
 const page=ctx.HensemLiveWithdrawPages.create({L,E:String,C:String,N:String,R:(n,d)=>d?n/d+'':'—',box:(_t,x)=>x,table:(_h,r)=>r.flat().join(''),page:()=> 'auto_withdraw',request:q=>{requests.push(q);return new Promise((a,b)=>{resolve=a;reject=b})},render:()=>{throw Error('must not repaint background')}});
 page.state.data={rows:[{country:'巴西',platform:'SYNTHETIC'},{country:'巴西',platform:'OTHER'}],totals:{},notes:[]};
 return {ctx,page,L,requests,paints,body:()=>body,html:()=>html,advance:()=>{now+=120000},respond:(n,overrides={})=>resolve({available:true,source:'SYNTHETIC',total:n,noteCount:n,rows:rows(n),canViewOrders:true,canViewBlockingOrders:true,summary:{operatorCounts:{manual:n,manualWithReason:n}},...overrides}),reject:e=>reject(e)};
}
test('complete seven-category result changes 20→50→100 without request/loading or losing scroll, even after TTL',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.respond(7);await settle();h.body().scrollTop=300;h.body().scrollLeft=40;h.advance();const paints=h.paints.length;
 h.ctx.withdrawReasonSize(50);h.ctx.withdrawReasonSize(100);h.ctx.withdrawReasonSize(20);await settle();
 assert.equal(h.requests.length,1);assert(h.paints.slice(paints).every(x=>!x.includes('正在读取')));assert.equal(h.body().scrollTop,300);assert.equal(h.body().scrollLeft,40);assert.equal(h.page.state.reasonData.rows.length,7);
});
test('large result fetches only necessary page; once 50 contains all 45 rows, local slicing preserves drill identity',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.respond(45,{rows:rows(20)});await settle();h.ctx.withdrawReasonSize(50);assert.equal(h.requests.length,2);assert.equal(h.requests[1].limit,50);h.respond(45);await settle();
 h.ctx.withdrawReasonSize(20);h.ctx.withdrawReasonPage(3);await settle();assert.equal(h.requests.length,2);assert.equal(h.page.state.reasonData.rows.length,5);assert.equal(h.page.state.reasonData.rows[0].reason,'规则 40');
 h.ctx.withdrawBlockingDrill(0,'blockingOrders');assert.equal(h.requests.length,3);assert.equal(h.requests.at(-1).reasonKey,(40).toString(16).padStart(32,'0'));assert.equal(h.requests.at(-1).offset,0);
});
test('partial server results still read target page without treating rows as full source',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.respond(120,{rows:rows(20)});await settle();h.ctx.withdrawReasonPage(2);assert.equal(h.requests.length,2);assert.equal(h.requests.at(-1).offset,20);h.respond(120,{rows:rows(20)});await settle();h.ctx.withdrawReasonSize(50);assert.equal(h.requests.at(-1).offset,0);assert.equal(h.requests.at(-1).limit,50);
});
test('date, platform, kind and submitted order search never reuse another snapshot',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.respond(7);await settle();
 h.ctx.withdrawReasonDate('2026-10-10');assert.equal(h.requests.length,2);h.respond(7);await settle();
 h.ctx.withdrawReasonKind('orders');assert.equal(h.requests.length,3);h.respond(7);await settle();
 h.ctx.withdrawReasonQuery('ORDER');h.ctx.withdrawReasonSearch();assert.equal(h.requests.length,4);assert.equal(h.requests.at(-1).query,'ORDER');h.respond(7);await settle();
 h.ctx.withdrawReasons(1);assert.equal(h.requests.length,5);assert.equal(h.requests.at(-1).platform,'OTHER');
});
test('explicit retry invalidates all same-scope page caches; errors cannot revive a previous snapshot',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.respond(7);await settle();h.ctx.withdrawReasonSize(50);h.ctx.withdrawReasonRetry();assert.equal(h.requests.length,2);h.reject(new Error('retry failed'));await settle();
 h.ctx.withdrawReasonSize(20);assert.equal(h.requests.length,3);h.respond(8);await settle();assert.equal(h.page.state.reasonData.total,8);
});
test('cancellation clears cached snapshots and ignores outstanding old responses',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.page.cancel();h.respond(7);await settle();assert.equal(h.page.state.reason,null);
 h.page.state.data={rows:[{country:'巴西',platform:'SYNTHETIC'}]};h.ctx.withdrawReasons(0);assert.equal(h.requests.length,2);h.respond(7);await settle();h.page.pause();h.ctx.withdrawReasonSize(50);assert.equal(h.requests.length,3);
});
test('unknown, mismatched and explicitly partial totals do not become complete snapshots',async()=>{
 for(const overrides of [{total:null},{total:false},{total:''},{total:'bad'},{total:8},{partial:true},{hasMore:true},{error:'partial failure'},{complete:false},{available:false}]){
  const h=fixture();h.ctx.withdrawReasons(0);h.respond(7,overrides);await settle();h.ctx.withdrawReasonSize(50);assert.equal(h.requests.length,2,JSON.stringify(overrides));
 }
});
test('zero complete result stays zero locally and does not assert upstream source coverage',async()=>{
 const h=fixture();h.ctx.withdrawReasons(0);h.respond(0,{coverage:{complete:false}});await settle();h.ctx.withdrawReasonSize(50);assert.equal(h.requests.length,1);assert.equal(h.page.state.reasonData.total,0);assert.equal(h.page.state.reasonData.coverage.complete,false);
});
test('all reason views use complete snapshots without starting a second request for size-only changes',async()=>{
 for(const kind of ['blocking','categories','rejection','operators','orders','blockingOrders','blockingVariants']){
  const h=fixture();h.page.state.reason={country:'巴西',platform:'SYNTHETIC',date:'2026-10-11',kind};h.ctx.withdrawReasonRetry();h.respond(7);await settle();h.ctx.withdrawReasonSize(50);assert.equal(h.requests.length,1,kind);
 }
});
