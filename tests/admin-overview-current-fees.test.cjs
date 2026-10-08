/* Real overview/fees renderers with synthetic orders and rates only. No network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harnessSource=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P}=new Function('require','__dirname',harnessSource+';return {ready,completeAggregate,P};')(require,__dirname);
const plain=html=>String(html).replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'').trim();
const tr=html=>[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(match=>[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>cell[1]));
function tables(html){return [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(match=>({headers:[...(match[0].match(/<thead>[\s\S]*?<\/thead>/)?.[0]||'').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(x=>plain(x[1])),rows:tr(match[0].match(/<tbody>[\s\S]*?<\/tbody>/)?.[0]||''),footer:tr(match[0].match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0]||'')}));}
const cell=(table,row,label)=>row[table.headers.indexOf(label)];
const section=(h,id)=>h.html().match(new RegExp('<section class="df-card" id="'+id+'">[\\s\\S]*?<\\/section>'))?.[0]||'';
function feeCard(h,direction='charge'){const html=(section(h,direction==='charge'?'df-collect':'df-payout').split('<div class="df-flow-fee">')[1]||'').split('<div class="df-state-tail">')[0];return {html,value:plain(html.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]||'')};}
const history=(row,amount)=>({...row,fee_version_estimated_amount:String(amount),fee_version_matched_count:row.success_count,fee_version_unmatched_count:0,fee_version_state:'complete'});
const rate=(extra={})=>({scopeType:'country',country:'印度',provider:'ExamplePay',collectFee:'4%',payoutFee:'3%',...extra});
async function setup(){
 const platforms=[{...P,name:'Alpha',source:'ar',team:'Example Team'},{...P,id:'22222222-2222-4222-8222-222222222222',name:'Beta',source:'newar',team:'Example Team'}],h=await ready({platforms});
 const a=completeAggregate(platforms[0],10,5),b=completeAggregate(platforms[1],20,6),w={...completeAggregate(platforms[0],10,3).summary[0],direction:'withdraw'};
 a.summary.push(w);a.groups.provider=[history({...a.summary[0],provider:'ExamplePay',success_count:4,success_amount:'400'},80),{...a.summary[0],provider:'FixedPay',all_count:1,all_amount:'100',success_count:1,success_amount:'100'},history({...w,provider:'ExamplePay'},15)];b.groups.provider=[history({...b.summary[0],provider:'ExamplePay'},10)];
 Object.assign(h.L,{results:[a,b],queryPlatforms:platforms,direction:'all',comparisonStatus:'idle',dirty:false,loading:false,pageQueried:true,overviewQueried:true,feeLookupLoading:false,feeLookupError:'',feeLookupRows:[rate(),rate({scopeType:'platform',platform:'Alpha',collectFee:'2%'}),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'}),rate({provider:'FixedPay',collectSingleFee:'6'})],view:'business'});
 h.c.render();return h;
}

test('overview defaults to current estimates and all dimension subtotals agree with the top cards',async()=>{
 const h=await setup(),before=JSON.stringify(h.L.results),calls=h.calls.length;
 assert.equal(h.L.feeEstimateMode,'current');assert.equal(feeCard(h).value,'38.00');assert.equal(feeCard(h,'withdraw').value,'9.00');assert.match(feeCard(h).html,/按当前费率估算/);assert.match(feeCard(h).html,/已匹配 10 \/ 11 笔/);assert.doesNotMatch(feeCard(h).html,/按订单创建时生效费率/);
 for(const dimension of ['teams','countries','platforms','providers'])for(const direction of ['charge','withdraw']){
  const table=tables(section(h,'df-'+dimension+'-'+direction))[0],fee=cell(table,table.footer[0],'估算手续费');
  assert.match(fee,new RegExp('>'+ (direction==='charge'?'38\\.00':'9\\.00')+'<'));assert.match(fee,/按当前费率估算/);
 }
 const providers=tables(section(h,'df-providers-charge'))[0],pay=providers.rows.find(row=>plain(row[0])==='ExamplePay');
 assert.match(cell(providers,pay,'手续费率'),/2\.00%|5\.00%|多档费率/);assert.equal(plain(cell(providers,pay,'手续费占比')),'100.00%');assert.equal(JSON.stringify(h.L.results),before);assert.equal(h.calls.length,calls);
});

test('overview historical mode reuses verified fees instead of the new estimates without mutating order facts',async()=>{
 const h=await setup(),before=JSON.stringify(h.L.results),calls=h.calls.length;h.L.feeEstimateMode='historical';h.c.render();
 assert.equal(feeCard(h).value,'90.00');assert.equal(feeCard(h,'withdraw').value,'15.00');assert.match(feeCard(h).html,/按订单创建时生效费率/);
 for(const dimension of ['teams','countries','platforms','providers']){const table=tables(section(h,'df-'+dimension+'-charge'))[0];assert.match(cell(table,table.footer[0],'估算手续费'),/>90\.00</);}
 h.L.feeLookupRows=h.L.feeLookupRows.map(row=>({...row,collectFee:'7%'}));h.c.render();assert.equal(feeCard(h).value,'90.00');assert.equal(JSON.stringify(h.L.results),before);assert.equal(h.calls.length,calls);
});

test('overview top coverage includes submitted summaries whose successful orders lack a provider breakdown',async()=>{
 const h=await setup();h.L.results[0].summary[0].success_count=7;h.L.results[0].summary[0].success_amount='700';h.c.render();
 assert.equal(feeCard(h).value,'38.00');assert.match(feeCard(h).html,/已匹配 10 \/ 13 笔/);assert.match(feeCard(h).html,/三方分组未完整提供/);assert.match(feeCard(h).html,/部分匹配/);
 for(const dimension of ['teams','countries','platforms']){const table=tables(section(h,'df-'+dimension+'-charge'))[0];assert.match(cell(table,table.footer[0],'估算手续费'),/应匹配 13/);}
});

test('overview fee cards never reuse a stale value while rates load or fail and never sum mixed currencies',async()=>{
 const h=await setup();for(const state of [{feeLookupLoading:true,feeLookupError:''},{feeLookupLoading:false,feeLookupError:'Synthetic rate error'}]){Object.assign(h.L,state);h.c.render();assert.equal(feeCard(h).value,'—');}
 Object.assign(h.L,{feeLookupLoading:false,feeLookupError:''});for(const row of [h.L.results[1].summary[0],...h.L.results[1].groups.provider])row.currency='USD';h.c.render();assert.equal(feeCard(h).value,'—');assert.doesNotMatch(feeCard(h).html,/>38\.00<|>0\.00</);
});

test('overview known zero rates stay zero while an unknown success scope remains unavailable',async()=>{
 const h=await setup();h.L.feeLookupRows=h.L.feeLookupRows.map(row=>({...row,collectFee:'0%'}));h.c.render();assert.equal(feeCard(h).value,'0.00');
 for(const row of [h.L.results[0].summary[0],...h.L.results[0].groups.provider.filter(row=>row.direction==='charge')]){row.success_count=null;row.success_amount=null;}h.c.render();assert.equal(feeCard(h).value,'—');assert.doesNotMatch(feeCard(h).html,/>0\.00<|100\.00%/);
});

test('provider fee details show estimated money separately from the reference rate and retain missing actual fees',async()=>{
 const h=await setup(),calls=h.calls.length,create=h.c.HensemLivePages.create;let context;h.c.HensemLivePages.create=value=>{context=value;return create(value)};h.c.render();h.L.view='fees';
 let html=create(context).render('providers'),table=tables(html).find(table=>table.headers.includes('实际手续费')),row=table.rows.find(row=>plain(row[0])==='ExamplePay'&&plain(row[2])==='ar'&&plain(row[3])==='代收');
 assert.match(cell(table,row,'估算手续费'),/>8\.00</);assert.equal(plain(cell(table,row,'当前参考费率')),'2.00%');assert.equal(plain(cell(table,row,'实际手续费')),'—');assert.match(html,/按当前费率估算/);
 h.L.feeEstimateMode='historical';html=create(context).render('providers');table=tables(html).find(table=>table.headers.includes('实际手续费'));row=table.rows.find(row=>plain(row[0])==='ExamplePay'&&plain(row[2])==='ar'&&plain(row[3])==='代收');assert.match(cell(table,row,'估算手续费'),/>80\.00</);assert.match(cell(table,row,'历史计费依据'),/订单创建时间/);assert.equal(plain(cell(table,row,'实际手续费')),'—');assert.equal(h.calls.length,calls);
});
