/* Production renderer with synthetic aggregates; no network or customer records. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harnessSource=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P}=new Function('require','__dirname',harnessSource+';return {ready,completeAggregate,P};')(require,__dirname);
const Y={...P,id:'aaaaaaaa-1111-4111-8111-111111111111',source:'kb',name:'YASH.BET',sourceName:'YASH.BET',country:'印度'};
const fact=(provider,count,success,direction='charge')=>({provider,direction,currency:'INR',all_count:count,all_amount:count*100,success_count:success,created_success_count:success,success_amount:success*100,pending_count:0,pending_amount:0,failed_count:count-success,failed_amount:(count-success)*100,rejected_count:0,rejected_amount:0,unknown_count:0,unknown_amount:0,missing_amount_count:0});
function result(platform,rows){const r=completeAggregate(platform,0,0);r.groups.provider=rows;r.summary=['charge','withdraw'].map(direction=>{const matching=rows.filter(x=>x.direction===direction);if(!matching.length)return null;const sum=fact('',0,0,direction);for(const row of matching)for(const key of Object.keys(sum))if(typeof sum[key]==='number')sum[key]+=Number(row[key]||0);return sum}).filter(Boolean);r.total=rows.reduce((sum,r)=>sum+r.all_count,0);return r;}
async function setup(rows,platforms=[Y],results){const h=await ready({page:'overview',platforms});Object.assign(h.L,{queryPlatforms:platforms,results:results||[result(platforms[0]||Y,rows)],country:'印度',currency:'INR',direction:'all',dirty:false,loading:false,catalogReady:true,pageQueried:true,overviewQueried:true,feeLookupRows:[],feeLookupLoading:false,comparisonStatus:'idle',from:'2026-10-08T00:00:00',to:'2026-10-08T23:59:59'});h.c.state.page='overview';h.c.render();return h;}
const section=(h,id)=>h.html().match(new RegExp('<section[^>]*id="'+id+'"[\\s\\S]*?<\\/section>'))?.[0]||'';
const rank=(h,d,tone)=>section(h,d==='charge'?'df-collect':'df-payout').match(new RegExp('<div class="df-provider-rank '+tone+'"[\\s\\S]*?<\\/div>(?=<div class="df-provider-rank|<\\/div>)'))?.[0]||'';
const names=html=>[...html.matchAll(/class="df-provider-rank-item"[^>]*><span>([^<]+)<\/span>/g)].map(m=>m[1]);
test('YASH-only query uses inclusive 300 creation count and shows the actual threshold',async()=>{
 const h=await setup([fact('AtThreshold',300,150),fact('TooSmall',299,299)]);
 assert.match(rank(h,'charge','high'),/data-provider-min-count="300"/);assert.match(rank(h,'charge','high'),/创建 ≥ 300 笔/);assert.deepEqual(names(rank(h,'charge','high')),['AtThreshold']);
 assert.match(rank(h,'charge','low'),/已列入高榜，低榜不重复/);assert.doesNotMatch(rank(h,'charge','high'),/>TooSmall</);
});
test('other sources, another KB platform and a multi-platform query retain 1000 even if only YASH responded',async()=>{
 const other={...P,id:'bbbbbbbb-1111-4111-8111-111111111111',name:'OTHER'};
 for(const platforms of [[other],[{...Y,source:'ar'}],[{...Y,name:'OTHER-KB',sourceName:'OTHER-KB'}],[Y,other]]){
  const h=await setup([fact('SmallPay',500,400)],platforms,[result(Y,[fact('SmallPay',500,400)])]);assert.match(rank(h,'charge','high'),/data-provider-min-count="1000"/);assert.match(rank(h,'charge','high'),/创建 ≥ 1,000 笔/);assert.deepEqual(names(rank(h,'charge','high')),[]);
 }
 const h=await setup([fact('SmallPay',500,400)]);h.L.queryPlatforms=[];h.c.render();assert.match(rank(h,'charge','high'),/data-provider-min-count="1000"/);assert.deepEqual(names(rank(h,'charge','high')),[]);
});
test('high and low lists stay disjoint and collection still excludes ArbPay only from the high list',async()=>{
 const rows=[fact('ArbPay',700,699),fact('A',650,520),fact('B',600,420),fact('C',550,330),fact('D',500,50),fact('ArbPay',449,440,'withdraw'),fact('普通提现',350,0,'withdraw')],h=await setup(rows);
 assert.deepEqual(names(rank(h,'charge','high')),['A','B','C']);assert.deepEqual(names(rank(h,'charge','low')),['D','ArbPay']);assert.deepEqual(names(rank(h,'withdraw','high')),['ArbPay']);assert.doesNotMatch(rank(h,'withdraw','low'),/>普通提现</);
});
test('the volume top-ten shortlist remains before success-rate sorting',async()=>{
 const rows=Array.from({length:10},(_,i)=>fact('Volume'+i,400+i,100)),h=await setup([...rows,fact('Rank11',300,300)]);
 assert.doesNotMatch(rank(h,'charge','high'),/>Rank11</);assert.doesNotMatch(rank(h,'charge','low'),/>Rank11</);
});
test('provider directory errors do not remove cards populated from aggregate groups',async()=>{
 const h=await setup([fact('KnownPay',300,100)]),before=rank(h,'charge','high'),calls=h.calls.length;
 h.L.providerOptions=[];h.L.providerOptionsError='Synthetic directory failure';h.c.render();assert.equal(rank(h,'charge','high'),before);assert.equal(h.calls.length,calls);
});
test('YASH missing provider label is display-only and retains original drilldown key, counts and amounts',async()=>{
 const rows=[fact('未识别通道',2,0),fact('KnownPay',300,150)],h=await setup(rows),before=JSON.stringify(h.L.results),html=section(h,'df-providers-charge');
 assert.match(html,/>未提供三方／通道<\/button>/);assert.match(html,/三方／通道字段为空或未提供/);assert.match(html,/订单仍计入总计/);assert.match(html,/>200.00<\/td><td>2<\/td>/);
 const callback=html.match(/onclick="(liveProviderOrders\(&quot;未识别通道&quot;[^\"]+)"/)[1].replaceAll('&quot;','"');let target;h.c.liveProviderOrders=(...args)=>{target=args};vm.runInContext(callback,h.c);
 assert.deepEqual(target,['未识别通道','','charge']);assert.equal(JSON.stringify(h.L.results),before);assert.match(html,/>30,200.00<\/td><td>302<\/td>/);
});
test('non-YASH and mixed-source missing groups keep their existing display identity',async()=>{
 const other={...P,id:'bbbbbbbb-1111-4111-8111-111111111111',name:'OTHER',source:'ar'};
 for(const results of [[result(other,[fact('未识别通道',2,0)])],[result(Y,[fact('未识别通道',2,0)]),result(other,[fact('未识别通道',3,0)])]]){
  const h=await setup([],results.map(r=>r.platform),results),html=section(h,'df-providers-charge');assert.doesNotMatch(html,/>未提供三方／通道<\/button>/);assert.match(html,/>未识别通道<\/button>/);
 }
});
