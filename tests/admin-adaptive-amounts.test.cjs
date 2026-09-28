const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const root={};vm.runInNewContext(fs.readFileSync('admin-preview/live-amount-bands.js','utf8'),{window:root});const bands=root.HensemAmountBands;
const compiled=ts.transpileModule(fs.readFileSync('src/lib/adminLiveBridge.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}},calls=[];vm.runInNewContext(compiled,{module:mod,exports:mod.exports,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline'}},require:()=>({ensureDashboardSession:async s=>s}),fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({rows:[]})}}});
const base={action:'aggregate',platformId:'11111111-1111-4111-8111-111111111111',startAt:'2026-09-27T00:00:00.000Z',endAt:'2026-09-28T00:00:00.000Z',direction:'all',currency:'INR'};
test('confirmed countries have separate ten-band deposit and withdrawal scales',()=>{
 const expected={INR:[[100,50000],[100,50000]],IDR:[[20000,50000000],[50000,1000000000]],BRL:[[5,50000],[10,15000]],PKR:[[100,50000],[200,50000]],VND:[[50000,300000000],[100000,200000000]],COP:[[20000,2000000],[30000,10000000]],MXN:[[100,50000],[100,50000]],CLP:[[5000,5000000],[8000,8000000]]};
 for(const [currency,pairs]of Object.entries(expected))for(const [i,direction]of ['charge','withdraw'].entries()){
  const p=bands.profile({currency,direction});assert(bands.valid(p.edges));assert.deepEqual([p.edges[0],p.edges[10]],pairs[i]);assert.equal(bands.keys().length,10);assert.match(p.source,/国家/);
 }
 assert.match(bands.profile({currency:'NGN'}).source,/限额未配置/);assert.equal(bands.profile({currency:'NGN'}).edges[10],1000000);
});
test('source limit parsing respects units, grouped periods, direction and currency; ambiguous values stay unknown',()=>{
 for(const [text,currency,expected]of [['100 (NGN)-1000000','NGN',[100,1000000]],['10-1w','INR',[10,10000]],['1000-5.000.000','VND',[1000,5000000]],['BRL 5–50.000','BRL',[5,50000]],['100.50–50,000.25 INR','INR',[100.5,50000.25]]])assert.deepEqual(Array.from(bands.parseLimit(text,currency)),expected);
 for(const text of ['100','无','0','500-100','100-500 USDT','BDT 100-500','100~500~1000','100-500 或 200-1000'])assert.equal(bands.parseLimit(text,'INR'),null,text);
 const p=bands.profile({currency:'INR',direction:'withdraw',providers:['PayA'],limits:['500-20000']});assert.equal(p.edges[0],500);assert.equal(p.edges[10],20000);assert(bands.valid(p.edges));assert.match(p.source,/三方/);
 assert.match(bands.label('band:0',p.edges),/^500–< /);assert.equal(bands.label('band:9',p.edges).endsWith('20,000'),true);assert.equal(bands.label('below',p.edges),'< 500');assert.equal(bands.label('above',p.edges),'> 20,000');assert.equal(bands.label('unknown',p.edges),'金额缺失');
});
test('bridge validates same dynamic boundaries for aggregate and range drilldown; exact buckets remain unchanged',()=>{
 const edges=Array.from(bands.profile({currency:'INR'}).edges),amountBands={charge:edges,withdraw:edges};
 for(const extra of [{},{view:'providers'},{view:'drilldown',kind:'amount_range',bucket:'band:0'},{view:'drilldown',kind:'matrix_range',bucket:'band:9',hour:23},{view:'drilldown',kind:'amount_range',bucket:'below'},{view:'drilldown',kind:'amount_range',bucket:'above'},{view:'drilldown',kind:'amount',bucket:'100'}])assert.doesNotThrow(()=>mod.exports.validateAdminLiveRequest({...base,amountBands,...extra}));
 for(const extra of [{amountBands:{charge:edges}},{amountBands:{charge:edges,withdraw:edges.slice(1)}},{amountBands:{...amountBands,foo:edges}},{amountBands:{charge:[0,...edges.slice(0,10)],withdraw:edges.map(()=>100)}},{view:'drilldown',kind:'amount_range',bucket:'band:10'},{view:'drilldown',kind:'amount_range',bucket:'100–200'},{action:'details'},{view:'drilldown',kind:'amount',bucket:'band:0'}])assert.throws(()=>mod.exports.validateAdminLiveRequest({...base,amountBands,...extra}));
});
test('member counts endpoint keeps exact scope and rejects incompatible filters',async()=>{
 const q={...base,action:'memberDaily',providers:['PayA']};assert.doesNotThrow(()=>mod.exports.validateAdminLiveRequest(q));
 for(const extra of [{status:'all'},{memberId:'user'},{amountBands:{}},{offset:0},{platformIds:[base.platformId]}])assert.throws(()=>mod.exports.validateAdminLiveRequest({...q,...extra}));
 await mod.exports.adminLiveRequest({user:{id:'offline'},access_token:'offline'},q);const r=calls.at(-1);assert.match(r.url,/dashboard_admin_live_member_daily$/);assert.equal(r.body.p_request.action,undefined);assert.equal(r.body.p_request.startAt,q.startAt);assert.deepEqual(r.body.p_request.providers,['PayA']);
});
