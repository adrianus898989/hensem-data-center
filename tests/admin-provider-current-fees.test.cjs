// Current provider fees use synthetic authorized leaves; no network or production writes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const shared=fs.readFileSync(require('node:path').join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order,plus,combine}=new Function('require','__dirname',shared+';return {fixture,order,plus,combine};')(require,__dirname);
const leaf=(platform='Alpha',amount=1000,count=10,extra={})=>order('id-'+platform,'ar',amount,count,{platform,country:'印度',direction:'charge',provider:'ExamplePay',...extra});
const rate=(extra={})=>({provider:'ExamplePay',country:'印度',scopeType:'country',collectFee:'4%',payoutFee:'4%',feeEffective:{charge:{state:'missing_effective_time'},withdraw:{state:'missing_effective_time'}},...extra});
const plain=s=>s.replace(/<[^>]*>/g,'').trim();
function setup(orders=[leaf()],rates=[rate()],direction='charge'){
 const h=fixture(orders);delete h.L.feeEstimateMode;h.L.feeLookupRows=rates;h.render(direction);return h;
}
function data(h){
 const html=h.html(),head=html.match(/<thead>([\s\S]*?)<\/thead>/)[1],columns=[...head.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(x=>plain(x[1]).replace(/ [↕↑↓]$/,''));
 const rows=where=>[...html.match(new RegExp('<'+where+'>([\\s\\S]*?)</'+where+'>'))[1].matchAll(/<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g)].map(x=>({kind:x[1]||'',cells:[...x[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1])}));
 return {columns,parents:rows('tbody').filter(r=>r.kind===''),children:rows('tbody').filter(r=>r.kind==='provider-platform-row'),footers:rows('tfoot'),value:(r,column)=>plain(r.cells[columns.indexOf(column)])};
}
const value=(h,name,column)=>{const d=data(h),r=d.parents.find(r=>plain(r.cells[0])===name);assert(r,'missing '+name);return d.value(r,column)};
function historical(row,amount){return {...row,fee_version_state:'complete',fee_version_matched_count:row.success_count,fee_version_unmatched_count:0,fee_version_estimated_amount:amount}}

test('default current mode prices both directions despite absent effective dates; parents, platform leaves and full footer reconcile',()=>{
 for(const direction of ['charge','withdraw']){
  const orders=[leaf('Alpha',1000,10,{direction}),leaf('Beta',2000,20,{direction}),leaf('Alpha',500,5,{direction,provider:'OtherPay'})];
  const rates=[rate(),rate({scopeType:'platform',platform:'Beta',collectFee:'2%',payoutFee:'2%'}),rate({provider:'OtherPay'})],h=setup(orders,rates,direction),before=h.networkCalls();
  assert.equal(value(h,'ExamplePay','估算手续费'),'80.00');assert.equal(value(h,'ExamplePay','手续费占比'),'80.00%');assert.equal(value(h,'OtherPay','估算手续费'),'20.00');
  assert.match(h.html(),/按当前费率估算/);assert.doesNotMatch(h.html(),/provider-partial cell-sub">缺少生效时间/);assert.match(h.html(),/手续费已匹配 35 \/ 35/);
  h.root.providerSummaryToggle(0);const d=data(h);assert.equal(d.children.length,2);
  const alpha=d.children.find(r=>plain(r.cells[0])==='Alpha'),beta=d.children.find(r=>plain(r.cells[0])==='Beta');
  assert.equal(d.value(alpha,'估算手续费'),'40.00');assert.equal(d.value(beta,'估算手续费'),'40.00');assert.equal(d.value(alpha,'手续费占比'),'50.00%');assert.equal(d.value(beta,'手续费占比'),'50.00%');
  assert.equal(d.value(alpha,'金额占比'),'33.33%');assert.equal(d.value(beta,'金额占比'),'66.67%');assert.equal(d.value(d.footers.at(-1),'估算手续费'),'100.00');assert.equal(d.value(d.footers.at(-1),'手续费占比'),'100.00%');
  h.root.providerSummaryRate(0);assert.match(h.drawers.at(-1).html,/生效日期缺失不阻止当前参考估算/);assert.equal(h.networkCalls(),before);
 }
});

test('switching to history restores immutable fees throughout parent, child and totals without fetching or leaking into current',()=>{
 const h=setup([historical(leaf(),17.25)]),before=h.networkCalls();h.root.providerSummaryToggle(0);assert.equal(value(h,'ExamplePay','估算手续费'),'40.00');
 h.root.providerSummaryFeeMode('historical');assert.equal(value(h,'ExamplePay','估算手续费'),'17.25');let d=data(h);assert.equal(d.value(d.children[0],'估算手续费'),'17.25');assert.equal(d.value(d.footers[0],'估算手续费'),'17.25');assert.match(h.html(),/按订单创建时间匹配费率版本/);
 h.L.feeLookupRows=[rate({collectFee:'5%'})];h.root.providerSummaryFeeMode('current');assert.equal(value(h,'ExamplePay','估算手续费'),'50.00');assert.equal(h.networkCalls(),before);
 h.L.feeLookupRows=[];h.render();assert.equal(value(h,'ExamplePay','估算手续费'),'—待确认');assert.equal(value(h,'ExamplePay','手续费占比'),'—');assert.doesNotMatch(h.html(),/>17\.25</);
});

test('partial and unavailable fees remain explicit; shares use only priced subtotal and zero fee denominators remain blank',()=>{
 const h=setup([leaf(),leaf('Beta',2000,20)], [rate(),rate({scopeType:'platform',platform:'Beta',collectFee:''})]);
 assert.equal(value(h,'ExamplePay','估算手续费'),'40.00部分');h.root.providerSummaryToggle(0);const d=data(h),beta=d.children.find(r=>plain(r.cells[0])==='Beta');
 assert.equal(d.value(beta,'估算手续费'),'—待确认');assert.equal(d.value(beta,'手续费占比'),'—');assert.equal(d.value(d.footers[0],'估算手续费'),'40.00部分');assert.match(h.html(),/待确认 20 笔/);assert.match(h.html(),/手续费已匹配 10 \/ 30/);assert.doesNotMatch(h.html(),/历史费率未匹配/);
 const zero=setup([leaf()],[rate({collectFee:'0%'})]);assert.equal(value(zero,'ExamplePay','估算手续费'),'0.00');assert.equal(value(zero,'ExamplePay','手续费占比'),'—');
 const unknown=setup([leaf('Alpha',null,10)]);assert.equal(value(unknown,'ExamplePay','估算手续费'),'—待确认');assert.equal(value(unknown,'ExamplePay','手续费占比'),'—');
});

test('current display never prices fixed fees without same-currency evidence and never borrows rejected platform/category rules',()=>{
 const orders=[leaf('Alpha',1000,10,{direction:'withdraw'})],fixed=rate({payoutSingleFee:'6'}),h=setup(orders,[fixed],'withdraw');assert.equal(value(h,'ExamplePay','估算手续费'),'—待确认');assert.match(h.html(),/固定费币种未确认/);
 h.L.feeLookupRows=[{...fixed,feeEffective:{withdraw:{state:'missing_effective_time',currency:'INR',source:{currencyCell:'B2'}}}}];h.render();assert.equal(value(h,'ExamplePay','估算手续费'),'100.00');
 for(const rates of [[rate(),rate({scopeType:'platform',platform:'Alpha',collectFee:''})],[rate({category:'UPI'}),rate({category:'USDT',collectFee:'1%'})]]){
  const invalid=setup([leaf()],rates);invalid.root.providerSummaryToggle(0);const d=data(invalid);assert.equal(value(invalid,'ExamplePay','估算手续费'),'—待确认');assert.equal(d.value(d.children[0],'当前参考费率'),'费率待核对');assert.equal(d.value(d.children[0],'手续费占比'),'—');
 }
});

test('current-page subtotal and all-result fees use the complete provider list and preserve provider fee sorting',()=>{
 const h=setup([leaf(),leaf('Alpha',2000,20,{provider:'OtherPay'}),leaf('Alpha',500,5,{provider:'ThirdPay'})],[rate(),rate({provider:'OtherPay',collectFee:'2%'}),rate({provider:'ThirdPay'})]);
 h.L.localSize=1;h.render();const d=data(h);assert.equal(d.footers.length,2);assert.equal(d.value(d.footers[0],'估算手续费'),'40.00');assert.equal(d.value(d.footers[1],'估算手续费'),'100.00');assert.equal(d.value(d.footers[0],'手续费占比'),'40.00%');
 h.root.providerSummarySort('estimated_fee');assert.match(h.html(),/providerSummarySort/);assert.equal(h.networkCalls(),0);
});

test('pure helpers preserve explicit mode and scope safeguards without changing historical defaults',()=>{
 const h=setup(),api=h.api,orders=[historical(leaf(),17.25)],options={orders,issues:null,rates:[rate()],country:'印度',direction:'charge',plus,combine};
 assert.equal(api.buildRows(options)[0].estimated_fee,17.25);assert.equal(api.buildRows({...options,feeMode:'current'})[0].estimated_fee,40);
 for(const extra of [{country:'巴西'},{currency:null},{platformId:null},{nativeFeeIdentityVerified:false}]){const r=api.buildRows({...options,orders:[leaf('Alpha',1000,10,extra)],feeMode:'current'})[0];assert.equal(r.estimated_fee,null);assert.equal(r.fee_complete,false);}
 const invalidZero=api.buildRows({...options,orders:[leaf('Alpha',0,0,{currency:null})],feeMode:'current'});assert.equal(api.feeSummary(invalidZero).amount,null);assert.equal(api.feeSummary(invalidZero).complete,false);
 const parent=api.buildRows({...options,orders:[leaf(),leaf('Alpha',1000,10,{provider:'人工充值'})],feeMode:'current'});assert.equal(api.feeSummary(parent).excludedCount,10);assert.equal(api.feeSummary(parent).amount,40);
});


test('fee summaries reject mixed current and historical amounts instead of mislabelling their sum',()=>{
 const h=setup(),api=h.api,options={orders:[historical(leaf(),17.25)],issues:null,rates:[rate()],country:'印度',direction:'charge',plus,combine};
 const current=api.buildRows({...options,feeMode:'current'})[0],history=api.buildRows(options)[0],summary=api.feeSummary([current,history]);
 assert.equal(summary.amount,null);assert.equal(summary.complete,false);assert.equal(summary.fee_mode,'mixed');assert.match(api.feeCoverageText(summary),/不能合计/);
 const ignored=api.feeSummary([current,{issueOnly:true,estimated_fee:null,fee_eligible_count:0}]);assert.equal(ignored.amount,40);assert.equal(ignored.fee_mode,'current');
});


test('current and previous fee comparisons use the same current rules with native platform identity',()=>{
 for(const direction of ['charge','withdraw']){
  const now=leaf('Alpha',2000,20,{direction}),prior=leaf('Alpha',1000,10,{direction}),h=setup([now],[rate()],direction),p={id:'id-Alpha',name:'Alpha',source:'ar',country:'印度',currency:'INR',timezone:'Asia/Kolkata'};
  h.L.queryPlatforms=[p];h.L.results=[{platform:p,groups:{provider:[now]}}];h.L.comparisonResults=[{platform:p,groups:{provider:[prior]}}];h.L.comparisonStatus='ready';h.render(direction);
  const feeCard=h.html().match(/<div class="provider-kpi provider-kpi-fee"[\s\S]*?<\/div><\/div>/)?.[0];assert(feeCard);assert.match(feeCard,/>80\.00</);assert.match(feeCard,/昨日 40\.00/);assert.match(feeCard,/100\.00%/);
 }
});

test('fee controls ignore an old page closure, permission loss, dirty filters and invalid modes',()=>{
 const h=setup();for(const change of [()=>{h.root.hensemCurrentAdminPage=()=> 'merchants';},()=>{h.root.hensemCurrentAdminPage=()=> 'providers';h.root.hensemRoleAllowed=()=>false;},()=>{h.root.hensemRoleAllowed=()=>true;h.L.dirty=true;}]){change();h.root.providerSummaryFeeMode('historical');assert.notEqual(h.L.feeEstimateMode,'historical');}
 h.L.dirty=false;h.root.providerSummaryFeeMode('untrusted');assert.notEqual(h.L.feeEstimateMode,'untrusted');h.root.providerSummaryFeeMode('historical');assert.equal(h.L.feeEstimateMode,'historical');
});
