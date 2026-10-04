/* Actual production renderer and fee facts, entirely synthetic; no live data or network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harnessSource=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P,settle}=new Function('require','__dirname',harnessSource+';return {ready,completeAggregate,P,settle};')(require,__dirname);
const plain=s=>String(s).replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'').trim();
function tables(html){return [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(m=>({html:m[0],headers:[...(m[0].match(/<thead>[\s\S]*?<\/thead>/)?.[0]||'').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(x=>plain(x[1])),rows:tr(m[0].match(/<tbody>[\s\S]*?<\/tbody>/)?.[0]||''),footer:tr(m[0].match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0]||'')}));}
function tr(html){return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1]));}
const ledger=h=>tables(h.html()).find(t=>t.headers.includes('使用三方'));
const cell=(t,row,label)=>row[t.headers.indexOf(label)];
const amount=html=>plain(html.replace(/<span class="merchant-fee-coverage-inline"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<span class="merchant-fee-status">[\s\S]*?<\/span>/g,'')).match(/^[\d,]+\.\d{2}|^—|^不适用/)?.[0];
function history(row,value,matched=row.success_count){return {...row,fee_version_estimated_amount:String(value),fee_version_matched_count:matched,fee_version_unmatched_count:row.success_count-matched,fee_version_state:matched===row.success_count?'complete':matched?'partial':'unknown'};}
const rate=(extra={})=>({scopeType:'country',country:'印度',provider:'ExamplePay',collectFee:'4%',payoutFee:'3%',...extra});
async function setup(){
 const platforms=[{...P,name:'Alpha',source:'ar'},{...P,id:'22222222-2222-4222-8222-222222222222',name:'Beta',source:'newar'}],h=await ready({platforms});
 const a=completeAggregate(platforms[0],10,5),b=completeAggregate(platforms[1],20,6),w={...completeAggregate(platforms[0],10,3).summary[0],direction:'withdraw'};
 a.summary.push(w);a.groups.provider=[history({...a.summary[0],provider:'ExamplePay',success_count:4,success_amount:'400'},80),{...a.summary[0],provider:'FixedPay',all_count:1,all_amount:'100',success_count:1,success_amount:'100'},history({...w,provider:'ExamplePay'},15)];
 b.groups.provider=[history({...b.summary[0],provider:'ExamplePay'},10)];
 h.c.setPage('merchants');Object.assign(h.L,{results:[a,b],queryPlatforms:platforms,direction:'all',comparisonStatus:'idle',dirty:false,loading:false,pageQueried:true,feeLookupLoading:false,feeLookupError:'',feeLookupRows:[rate(),rate({scopeType:'platform',platform:'Alpha',collectFee:'2%'}),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'}),rate({provider:'FixedPay',collectSingleFee:'6'})],view:'business'});
 h.c.render();return h;
}
function open(h,platform='Alpha'){
 const t=ledger(h),row=platform==='total'?t.footer[0]:t.rows.find(r=>plain(r[0])===platform),usage=cell(t,row,'使用三方'),index=Number(usage.match(/liveMerchantProviderUsage\((\d+)\)/)[1]);
 if(!usage.includes('aria-expanded="true"'))h.c.liveMerchantProviderUsage(index);
 return currentInline(h,platform);
}
function currentInline(h,platform='Alpha'){
 const t=ledger(h),entries=[...t.html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)],index=entries.findIndex(r=>!r[1].includes('merchant-provider-')&&plain(r[2].match(/<td\b[^>]*>([\s\S]*?)<\/td>/)?.[1]||'')===(platform==='total'?'已读汇总 · INR':platform)),note=entries[index+1];assert.match(note?.[1]||'',/merchant-provider-inline-note/);
 const children=[];for(const r of entries.slice(index+2)){if(!r[1].includes('merchant-provider-inline-row'))break;children.push(r[0]);}
 return {html:note[0]+'<table>'+t.html.match(/<thead>[\s\S]*?<\/thead>/)[0]+'<tbody>'+children.join('')+'</tbody></table>'};
}
const reference=(row,d)=>row[0].match(new RegExp(d+'当前参考费率：([\\s\\S]*?)(?=；代(?:收|付)当前参考费率：|"|$)'))?.[1]||'';
function connectedInline(h){
 const query=h.c.document.querySelector;let detached=false;
 h.c.document.querySelector=selector=>{if(selector.startsWith('[data-merchant-provider-inline=')){const marker=selector.match(/"(\d+)"/)?.[1];return !detached&&h.html().includes('data-merchant-provider-inline="'+marker+'"')?{isConnected:true}:null;}return query(selector);};
 return {replace(){detached=true;}};
}
function feeCard(h,direction){const section=h.html().match(new RegExp('<section class="live-reference-direction" data-direction="'+direction+'">[\\s\\S]*?<\\/section>'))?.[0]||'',html=section.slice(section.indexOf('<div class="kpi" data-metric="fee"'));return {html,value:plain(html.match(/<div class="kpi-value">([\s\S]*?)<\/div>/)?.[1]||'')};}

test('merchant defaults to current reference estimates with native platform exceptions, success-time counts and explicit partial coverage',async()=>{
 const h=await setup(),before=JSON.stringify(h.L.results),calls=h.calls.length,t=ledger(h),a=t.rows.find(r=>plain(r[0])==='Alpha'),b=t.rows.find(r=>plain(r[0])==='Beta');
 assert.equal(h.L.feeEstimateMode,'current');assert.match(h.html(),/aria-label="商户手续费估算口径"/);assert.match(h.html(),/<option value="current" selected>/);assert.match(h.html(),/不是历史实际手续费/);assert.match(h.html(),/所选成功时间内的成功金额、笔数/);
 assert.equal(amount(cell(t,a,'代收手续费')),'8.00');assert.match(cell(t,a,'代收手续费'),/已匹配 4 \/ 5 笔（80\.00%）/);assert.match(cell(t,a,'代收手续费'),/固定费币种未确认/);assert.equal(amount(cell(t,b,'代收手续费')),'30.00');assert.match(cell(t,b,'代收手续费'),/已匹配 6 \/ 6 笔（100\.00%）/);
 assert.equal(amount(cell(t,a,'代付手续费')),'9.00');assert.equal(plain(cell(t,a,'代收成功金额')),'500.00');assert.equal(plain(cell(t,a,'代收成功笔数')),'5');assert.equal(JSON.stringify(h.L.results),before);assert.equal(h.calls.length,calls);
});

test('currency subtotals and merchant provider view use original platform leaves and preserve the unpriced portion',async()=>{
 const h=await setup(),calls=h.calls.length,t=ledger(h),subtotal=t.footer[0];
 assert.equal(amount(cell(t,subtotal,'代收手续费')),'38.00');assert.match(cell(t,subtotal,'代收手续费'),/已匹配 10 \/ 11 笔（90\.91%）/);assert.equal(amount(cell(t,subtotal,'代付手续费')),'9.00');
 h.c.liveReferenceSet('view','providers');const providers=tables(h.html()).find(t=>t.headers[0]==='三方'&&t.headers.includes('来源')),pay=providers.rows.find(r=>plain(r[0])==='ExamplePay'),fixed=providers.rows.find(r=>plain(r[0])==='FixedPay');
 assert.equal(amount(cell(providers,pay,'代收手续费')),'38.00','2% Alpha plus 5% Beta, not one merged provider rate');assert.match(cell(providers,pay,'代收手续费'),/已匹配 10 \/ 10 笔（100\.00%）/);assert.equal(amount(cell(providers,fixed,'代收手续费')),'—');assert.match(cell(providers,fixed,'代收手续费'),/已匹配 0 \/ 1 笔（0\.00%）/);assert.match(cell(providers,fixed,'代收手续费'),/固定费币种未确认/);assert.equal(h.calls.length,calls);
});

test('switching to historical reuses immutable verified fees and changes sorting and subtotals without fetching or rewriting facts',async()=>{
 const h=await setup(),calls=h.calls.length,before=JSON.stringify(h.L.results),id='merchant-platforms-unified';let t=ledger(h);
 h.c.liveReferenceTableSort(encodeURIComponent(id),t.headers.indexOf('代收手续费'));assert.equal(plain(ledger(h).rows[0][0]),'Beta');
 h.c.liveMerchantFeeMode('historical');t=ledger(h);assert.equal(plain(t.rows[0][0]),'Alpha');assert.equal(amount(cell(t,t.rows[0],'代收手续费')),'80.00');assert.match(cell(t,t.rows[0],'代收手续费'),/已匹配部分/);assert.equal(amount(cell(t,t.footer[0],'代收手续费')),'90.00');assert.equal(amount(cell(t,t.footer[0],'代付手续费')),'15.00');assert.match(h.html(),/<option value="historical" selected>/);assert.match(h.html(),/按订单创建时间匹配已发布的生效版本/);
 h.L.feeLookupRows=h.L.feeLookupRows.map(r=>({...r,collectFee:'7%'}));h.c.render();assert.equal(amount(cell(ledger(h),ledger(h).footer[0],'代收手续费')),'90.00','current reference changes never reprice verified historical fees');
 h.c.liveMerchantFeeMode('current');t=ledger(h);assert.equal(amount(cell(t,t.footer[0],'代收手续费')),'70.00');assert.equal(JSON.stringify(h.L.results),before);assert.equal(h.calls.length,calls);
});

test('inline usage shows canonical per-provider current amounts, matching coverage and direction-specific unknowns in the exact native scope',async()=>{
 const h=await setup(),calls=h.calls.length,drawer=open(h),t=tables(drawer.html).find(t=>t.headers[0]==='平台'),pay=t.rows.find(r=>plain(r[0]).startsWith('ExamplePay')),fixed=t.rows.find(r=>plain(r[0]).startsWith('FixedPay'));
 assert.equal(t.rows.length,2);assert.match(drawer.html,/当前费率参考估算/);assert.match(drawer.html,/不是历史实际手续费/);assert.equal(amount(cell(t,pay,'代收手续费')),'8.00');assert.match(cell(t,pay,'代收手续费'),/已匹配 4 \/ 4 笔（100\.00%）/);assert.equal(reference(pay,'代收'),'2.00%');assert.equal(amount(cell(t,pay,'代付手续费')),'9.00');assert.equal(amount(cell(t,fixed,'代收手续费')),'—');assert.match(cell(t,fixed,'代收手续费'),/固定费币种未确认/);assert.match(cell(t,fixed,'代收手续费'),/待确认 1 笔/);assert.equal(plain(cell(t,fixed,'代付手续费')),'—');assert.doesNotMatch([cell(t,pay,'代收手续费'),cell(t,pay,'代付手续费'),cell(t,fixed,'代收手续费')].join(''),/>30\.00<|>90\.00<|历史费率未匹配|生效日期待确认/);assert.equal(h.calls.length,calls);
 const all=open(h,'total'),allTable=tables(all.html).find(t=>t.headers[0]==='平台');assert.equal(allTable.rows.length,2);assert.equal(amount(cell(allTable,allTable.rows.find(r=>plain(r[0]).startsWith('ExamplePay')),'代收手续费')),'38.00');
});

test('expanded merchant rows refresh their mode, while an old mode callback cannot collapse or reopen historical facts',async()=>{
 const h=await setup();connectedInline(h);open(h);const callback=h.c.liveMerchantProviderUsage,calls=h.calls.length;
 h.c.liveMerchantFeeMode('historical');assert.match(currentInline(h).html,/历史生效费率/);assert.match(currentInline(h).html,/80\.00/);assert.match(currentInline(h).html,/当前参考费率只供核对/);
 const html=h.html();callback(0);assert.equal(h.html(),html,'a handler from the old estimate mode expires');h.c.liveMerchantFeeMode('current');assert.match(currentInline(h).html,/8\.00/);assert.doesNotMatch(currentInline(h).html,/80\.00/);assert.equal(h.calls.length,calls);assert.equal(h.drawers.length,0);
});

test('current reference load completion updates expanded exact rows without another order request',async()=>{
 const h=await setup();connectedInline(h);let resolveRates;h.setHandler(q=>q.action==='rates'?new Promise(resolve=>{resolveRates=resolve}):{rows:[],total:0});h.L.feeLookupRows=null;h.c.render();assert.equal(h.L.feeLookupLoading,true);assert.match(open(h).html,/读取中…/);const calls=h.calls.length;
 resolveRates({rows:[rate({collectFee:'5%'})],total:1});await settle();const t=tables(currentInline(h).html).find(t=>t.headers[0]==='平台'),pay=t.rows.find(r=>plain(r[0]).startsWith('ExamplePay'));
 assert.equal(reference(pay,'代收'),'5.00%');assert.equal(amount(cell(t,pay,'代收手续费')),'20.00');assert.equal(plain(cell(t,pay,'代收匹配占比')),'100.00%');assert.match(cell(t,pay,'代收手续费'),/已匹配 4 \/ 4 笔（100\.00%）/);assert.equal(h.calls.length,calls);assert.equal(h.calls.filter(q=>q.action==='rates').length,1);assert.equal(h.drawers.length,0);
});

test('collapse, replacement, permission loss, edited scope, new query and navigation all expire an asynchronous inline refresh',async()=>{
 const mutations=[h=>h.c.liveMerchantProviderUsage(0),(h,d)=>d.replace(),h=>{h.L.dirty=true;},h=>{h.L.loading=true;},h=>{h.L.from='2026-09-21T00:00:00';},h=>{h.L.serial++;},h=>{h.L.results=[...h.L.results];},h=>{h.c.state.page='overview';},h=>{h.L.view='providers';},h=>{h.c.hensemRoleAllowed=(page,action)=>action!=='detail';}];
 for(const change of mutations){const h=await setup(),d=connectedInline(h);open(h);change(h,d);const before=h.html(),writes=h.writes.length,calls=h.calls.length;h.L.feeLookupRows=[rate({collectFee:'7%'})];h.c.liveMerchantFeeRefresh();assert.equal(h.html(),before);assert.equal(h.writes.length,writes);assert.equal(h.drawers.length,0);assert.equal(h.calls.length,calls);}
});

test('unknown success, unknown native currency and unsupported reference rules do not turn into zero estimates or complete coverage',async()=>{
 for(const mutation of [h=>{for(const row of [h.L.results[0].summary[0],...h.L.results[0].groups.provider.filter(r=>r.direction==='charge')]){row.success_count=null;row.success_amount=null;}},h=>{h.L.results[0].groups.provider[0].currency=null;},h=>{h.L.feeLookupRows=h.L.feeLookupRows.map(r=>r.provider==='ExamplePay'&&r.platform==='Alpha'?{...r,collectFee:'2% / 3%'}:r);}]){
  const h=await setup();mutation(h);h.c.render();const t=ledger(h),a=t.rows.find(r=>plain(r[0])==='Alpha'),fee=cell(t,a,'代收手续费');assert.equal(amount(fee),'—');assert.doesNotMatch(fee,/NaN|Infinity|0\.00<|100\.00%/);assert.match(fee,/待确认|已匹配 0 \/ 5 笔（0\.00%）/);
 }
});

test('fee mode is retained by the merchant tab snapshot and cannot be changed through another page or an unauthorized callback',async()=>{
 const h=await setup();h.c.liveMerchantFeeMode('historical');h.c.setPage('time');h.L.feeEstimateMode='current';h.c.setPage('merchants');assert.equal(h.L.feeEstimateMode,'historical');assert.match(h.html(),/<option value="historical" selected>/);const calls=h.calls.length;
 h.c.liveMerchantFeeMode('unsupported');assert.equal(h.L.feeEstimateMode,'historical');h.c.hensemRoleAllowed=()=>false;h.c.liveMerchantFeeMode('current');assert.equal(h.L.feeEstimateMode,'historical');h.c.hensemRoleAllowed=()=>true;h.c.state.page='overview';h.c.liveMerchantFeeMode('current');assert.equal(h.L.feeEstimateMode,'historical');assert.equal(h.calls.length,calls);
});

test('the fee subtotal remains the complete loaded scope while rows are locally sorted and paged',async()=>{
 const h=await setup(),id='merchant-platforms-unified',calls=h.calls.length;h.L.tableSizes[id]=1;h.L.tablePages[id]=2;h.c.render();let t=ledger(h);assert.equal(t.rows.length,1);assert.equal(amount(cell(t,t.footer[0],'代收手续费')),'38.00');
 h.c.liveReferenceTableSort(encodeURIComponent(id),t.headers.indexOf('代收手续费'));t=ledger(h);assert.equal(h.L.tablePages[id],1);assert.equal(plain(t.rows[0][0]),'Beta');assert.equal(amount(cell(t,t.footer[0],'代收手续费')),'38.00');assert.match(cell(t,t.footer[0],'代收手续费'),/已匹配 10 \/ 11 笔（90\.91%）/);assert.equal(h.calls.length,calls);
});

test('merchant top fee cards share the current and historical table facts, while WG missing withdrawal success time remains unknown in both modes',async()=>{
 const h=await setup(),calls=h.calls.length;let a=feeCard(h,'charge'),w=feeCard(h,'withdraw');assert.equal(a.value,'38.00');assert.equal(w.value,'9.00');assert.match(a.html,/当前费率参考估算/);assert.match(a.html,/已匹配 10 \/ 11 笔/);assert.match(a.html,/非历史实际手续费/);
 h.c.liveMerchantFeeMode('historical');a=feeCard(h,'charge');w=feeCard(h,'withdraw');assert.equal(a.value,'90.00');assert.equal(w.value,'15.00');assert.match(a.html,/历史生效手续费/);assert.match(a.html,/按订单创建时间匹配生效版本/);
 h.L.results[0].platform.source='wg';h.L.results[0].withdrawSuccessTimeAvailable=false;for(const mode of ['current','historical']){h.c.liveMerchantFeeMode(mode);a=feeCard(h,'charge');w=feeCard(h,'withdraw');assert.equal(a.value,mode==='current'?'38.00':'90.00');assert.equal(w.value,'—');assert.match(w.html,/匹配范围待确认/);const t=ledger(h);assert.equal(plain(cell(t,t.rows.find(r=>plain(r[0])==='Alpha'),'代付手续费')),'—');assert.doesNotMatch(w.html,/9\.00|15\.00|0\.00|100\.00%/);}
 assert.equal(h.calls.length,calls);
});

test('current inline rows do not show a borrowed country rate after its native platform exception or category has failed closed',async()=>{
 for(const mutation of [h=>{h.L.feeLookupRows=h.L.feeLookupRows.map(r=>r.platform==='Alpha'?{...r,collectFee:''}:r);},h=>{h.L.results[0].groups.provider[0].channel_type='USDT';h.L.feeLookupRows=h.L.feeLookupRows.map(r=>r.platform==='Alpha'?{...r,category:'UPI'}:r);}]){
  const h=await setup();mutation(h);h.c.render();const drawer=open(h),t=tables(drawer.html).find(t=>t.headers[0]==='平台'),pay=t.rows.find(r=>plain(r[0]).startsWith('ExamplePay'));assert.equal(amount(cell(t,pay,'代收手续费')),'—');assert.match(reference(pay,'代收'),/费率待核对|原始类型费率未匹配/);assert.doesNotMatch(reference(pay,'代收'),/4\.00%|2\.00%/);
 }
});
