/* Synthetic provider drilldowns only. No live customer orders or credentials. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.join(__dirname,'../admin-preview');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(){
 const platforms=[{id:'a',name:'Same platform',source:'ar',country:'印度',timezone:'Asia/Kolkata'},{id:'b',name:'Same platform',source:'newar',country:'印度',timezone:'Asia/Kolkata'},{id:'c',name:'Other provider only',source:'ar',country:'印度',timezone:'Asia/Kolkata'}];
 const drawers=[],requests=[],raw=[{provider:'USDT',raw_provider:'USDT(TRC20)-3',channel_type:'USDT'},{provider:'USDT',raw_provider:'USDT(TRC20)-4',channel_type:'USDT'}];
 const records=Object.fromEntries(platforms.map((p,k)=>[p.id,Array.from({length:k===0?25:k===1?3:1},(_,i)=>({...raw[i%2],order_number:'SYNTHETIC-'+p.id+'-'+i,amount:100+i,status:'已支付',created_at:'2026-09-25T12:00:00Z',success_at:'2026-09-26T12:00:00Z',member_id:'DO-NOT-RENDER',bank_account:'DO-NOT-RENDER'}))]));
 const L={loading:false,dirty:false,serial:9,status:'all',from:'2026-09-26T00:00:00',to:'2026-09-26T23:59:59',currency:'INR',multi:{team:['M8'],platform:[],provider:['Old selection']},results:platforms.map((p,k)=>({platform:p,groups:{provider:[{provider:k===2?'OtherPay':'USDT',direction:'charge',all_count:records[p.id].length,success_count:records[p.id].length}]}}))};
 let handler=q=>({total:records[q.platformId].length,rows:records[q.platformId].slice(q.offset,q.offset+q.limit)});
 const root={};root.window=root;vm.createContext(root);vm.runInContext(fs.readFileSync(path.join(folder,'live-provider-orders.js'),'utf8'),root);
 const api=root.HensemProviderOrders.create({L,E,N:n=>String(n??'—'),C:n=>String(n||0),table:(headers,rows)=>'<table><thead>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table>',box:(title,body)=>'<section><h2>'+E(title)+'</h2>'+body+'</section>',formatTime:v=>v,query:p=>({action:'details',platformId:p.id,startAt:'2026-09-25T18:30:00Z',endAt:'2026-09-26T18:30:00Z',status:L.status,providers:['Old selection']}),request:async q=>{requests.push(q);return handler(q)},openDrawer:(title,html)=>drawers.push({title,html})});
 return {root,api,L,platforms,records,requests,drawers,setHandler:fn=>{handler=fn},html:()=>drawers.at(-1).html};
}

test('USDT drawer presents unmodified original channel/type with an explicit unconfirmed merchant explanation',async()=>{
 const h=fixture(),before=JSON.stringify(h.L);await h.api.open('USDT','','charge');
 assert.match(h.html(),/USDT\(TRC20\)-3/);assert.match(h.html(),/USDT\(TRC20\)-4/);assert.match(h.html(),/原始三方 \/ 通道/);assert.match(h.html(),/支付商尚未确认/);assert.match(h.html(),/28 笔/);assert.doesNotMatch(h.html(),/Other provider only|DO-NOT-RENDER|UniPay|TronPay/);
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].status,'success');assert.equal(h.requests[0].providers[0],'USDT');assert.equal(h.requests[0].startAt,'2026-09-25T18:30:00Z');assert.equal(JSON.stringify(h.L),before);
 h.root.liveProviderOrder(0);assert.match(h.html(),/SYNTHETIC-a-0/);assert.match(h.html(),/USDT\(TRC20\)-3/);assert.match(h.html(),/归类三方/);assert.match(h.html(),/支付商待核对/);assert.doesNotMatch(h.html(),/DO-NOT-RENDER/);
 h.root.liveProviderOrdersBack();assert.match(h.html(),/三方订单平台/);
});

test('a platform child opens only that stable platform identity; no display-name match or unqueried platform is accepted',async()=>{
 const h=fixture();await h.api.open('USDT','','charge','b');assert.equal(h.requests.length,1);assert.equal(h.requests[0].platformId,'b');assert.match(h.html(),/3 笔 · 按平台分页/);assert.match(h.html(),/value="b" selected/);assert.doesNotMatch(h.html(),/SYNTHETIC-a-/);
 const count=h.requests.length;await h.api.open('USDT','','charge','c');await h.root.liveProviderOrderPlatform('c');await h.root.liveProviderOrderPlatform('__proto__');assert.equal(h.requests.length,count);
 await h.root.liveProviderOrderPlatform('a');assert.equal(h.requests.at(-1).platformId,'a');assert.equal(h.requests.at(-1).offset,0);assert.match(h.html(),/25 笔 · 按平台分页/);
 await h.root.liveProviderOrderPage(2);assert.equal(h.requests.at(-1).offset,20);assert.match(h.html(),/SYNTHETIC-a-24/);
 await h.root.liveProviderOrderPlatform('b');assert.equal(h.requests.at(-1).offset,0);assert.match(h.html(),/1 \/ 1/);
 await h.root.liveProviderOrderPlatform('');assert.match(h.html(),/28 笔 · 按平台分页/);
});

test('platform changes cancel late responses and updated totals never masquerade as the summary cohort',async()=>{
 const h=fixture();let resolve;h.setHandler(q=>q.platformId==='a'?new Promise(r=>{resolve=r}):({total:3,rows:h.records.b}));const pending=h.api.open('USDT','','charge');await h.root.liveProviderOrderPlatform('b');resolve({total:25,rows:h.records.a.slice(0,20)});await pending;assert.match(h.html(),/SYNTHETIC-b-0/);assert.doesNotMatch(h.html(),/SYNTHETIC-a-0/);
 h.setHandler(()=>({total:4,rows:h.records.b}));await h.root.liveProviderOrderBasis('created');assert.match(h.html(),/来源订单已更新/);assert.doesNotMatch(h.html(),/SYNTHETIC-b-0/);
});

test('failed detail reads show a retry without an empty-order result and retry preserves the original scope',async()=>{
 const h=fixture();h.setHandler(()=>{throw Error('读取超时')});await h.api.open('USDT','','charge','b');
 assert.match(h.html(),/读取超时/);assert.match(h.html(),/>重试<\/button>/);assert.match(h.html(),/3 笔 · 按平台分页/);assert.doesNotMatch(h.html(),/<table>|SYNTHETIC-/);
 h.setHandler(q=>({total:h.records[q.platformId].length,rows:h.records[q.platformId].slice(q.offset,q.offset+q.limit)}));await h.root.liveProviderOrderPage(1);
 assert.equal(h.requests.at(-1).platformId,'b');assert.equal(h.requests.at(-1).providers[0],'USDT');assert.equal(h.requests.at(-1).offset,0);assert.match(h.html(),/SYNTHETIC-b-0/);assert.doesNotMatch(h.html(),/读取超时/);
});

test('original USDT labels are escaped, missing evidence stays missing, and known merchant names are not rewritten',async()=>{
 const h=fixture(),raw='<img src=x onerror=alert(1)> USDT " &';h.records.a[0].raw_provider=raw;await h.api.open('USDT','','charge','a');assert.match(h.html(),/&lt;img/);assert.doesNotMatch(h.html(),/<img/);h.root.liveProviderOrder(0);assert.match(h.html(),/&quot;/);assert.doesNotMatch(h.html(),/<img/);
 assert.match(h.api.reason({provider:'USDT',raw_provider:null}),/原始通道未提供/);assert.equal(h.api.reason({provider:'UniPayUSDT',raw_provider:'UniPayUSDT',channel_type:'USDT'}),'按原始三方展示');
});

test('an explicit merchant-row currency limits authorized targets, counts, pages and requests without mixing another currency',async()=>{
 const h=fixture();h.records.a=h.records.a.map((r,i)=>({...r,currency:i<23?'INR':'USDT'}));h.records.b=h.records.b.map(r=>({...r,currency:'INR'}));h.L.results[0].groups.provider=[{provider:'USDT',direction:'charge',currency:'INR',all_count:23,success_count:23},{provider:'USDT',direction:'charge',currency:'USDT',all_count:2,success_count:2}];h.L.results[1].groups.provider[0].currency='INR';
 h.setHandler(q=>{const rows=h.records[q.platformId].filter(r=>r.currency===q.currency);return {total:rows.length,rows:rows.slice(q.offset,q.offset+q.limit)}});const before=JSON.stringify(h.L);
 await h.api.open('USDT','','charge','','INR');assert.match(h.html(),/26 笔 · 按平台分页/);assert.equal(h.requests[0].platformId,'a');assert.equal(h.requests[0].currency,'INR');assert.match(h.html(),/SYNTHETIC-a-19/);assert.doesNotMatch(h.html(),/SYNTHETIC-a-23|SYNTHETIC-a-24/);
 await h.root.liveProviderOrderPage(2);assert(h.requests.every(q=>q.currency==='INR'));assert.match(h.html(),/SYNTHETIC-a-22/);assert.match(h.html(),/SYNTHETIC-b-2/);assert.doesNotMatch(h.html(),/SYNTHETIC-a-23|SYNTHETIC-a-24/);assert.equal(JSON.stringify(h.L),before);
 await h.api.open('USDT','','charge','','USDT');assert.equal(h.requests.at(-1).platformId,'a');assert.equal(h.requests.at(-1).currency,'USDT');assert.match(h.html(),/2 笔 · 按平台分页/);assert.match(h.html(),/SYNTHETIC-a-23/);assert.match(h.html(),/SYNTHETIC-a-24/);assert.doesNotMatch(h.html(),/SYNTHETIC-b-|value="b"/);const calls=h.requests.length;await h.root.liveProviderOrderPlatform('b');await h.root.liveProviderOrderPlatform('unqueried-platform');assert.equal(h.requests.length,calls);
});

test('unknown, invalid and unobserved explicit currencies never fall back to the current dashboard currency',async()=>{
 const h=fixture();for(const currency of [null,'','inr','INR<script>']){await h.api.open('USDT','','charge','',currency);assert.match(h.html(),/币种未确认/);assert.equal(h.requests.length,0);}
 await h.api.open('USDT','','charge','','INR');assert.match(h.html(),/已查询结果没有该三方与币种/);assert.equal(h.requests.length,0,'provider groups with missing currency are not silently labelled INR from L.currency');assert.doesNotMatch(h.html(),/0 笔|<table>/);
});

test('currency-scoped detail responses with missing or another currency remain errors rather than displayed mixed records',async()=>{
 const h=fixture();h.L.results[1].groups.provider[0].currency='INR';for(const currency of [undefined,'USDT']){h.setHandler(()=>({total:3,rows:h.records.b.map(r=>({...r,currency}))}));await h.api.open('USDT','','charge','b','INR');assert.equal(h.requests.at(-1).currency,'INR');assert.match(h.html(),/订单币种与汇总行不一致/);assert.match(h.html(),/>重试<\/button>/);assert.doesNotMatch(h.html(),/<table>|SYNTHETIC-b-/);}
});

const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture:summaryFixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
test('USDT summary has a visible original-channel entry and platform rows carry only their stable IDs',()=>{
 const h=summaryFixture([order('a','ar',100,1,{provider:'USDT',direction:'charge',platform:'Same platform'}),order('b','newar',200,2,{provider:'USDT',direction:'charge',platform:'Same platform'})]),calls=[];h.root.liveProviderOrders=(...args)=>calls.push(args);h.render('charge');assert.match(h.html(),/原始通道 \/ 订单/);h.root.providerSummaryOrders(0);assert.deepEqual(calls[0],['USDT','','charge','']);h.root.providerSummaryToggle(0);assert.equal((h.html().match(/>查看订单<\/button>/g)||[]).length,2);assert.match(h.html(),/providerSummaryOrders\(0,&quot;a&quot;\)/);assert.match(h.html(),/providerSummaryOrders\(0,&quot;b&quot;\)/);
 h.root.providerSummaryOrders(0,'b');assert.deepEqual(calls[1],['USDT','','charge','b']);h.root.providerSummaryOrders(0,'foreign');assert.equal(calls.length,2);assert.equal(h.networkCalls(),0);
});

test('sheet-only workorder USDT summaries do not expose fabricated transaction order links',()=>{
 const h=summaryFixture([]),calls=[];h.root.liveProviderOrders=(...args)=>calls.push(args);h.L.workorders={byProvider:[{provider:'USDT',direction:'charge',submittedAmount:100,submittedCount:1}],coverage:{complete:true,capturedPlatformDays:1}};h.render('charge');assert.match(h.html(),/仅工单汇总/);assert.doesNotMatch(h.html(),/原始通道 \/ 订单/);h.root.providerSummaryOrders(0);assert.equal(calls.length,0);
});

test('a platform with only created orders opens its populated time basis rather than another platform success basis',async()=>{const h=fixture();h.L.results[1].groups.provider[0].success_count=0;await h.api.open('USDT','','charge','b');assert.equal(h.requests[0].status,'all');assert.match(h.html(),/创建时间读取/);assert.equal(h.requests[0].platformId,'b')});

test('first asynchronous detail paint shows loading, never an empty-record caption, before the real rows arrive',async()=>{
 const h=fixture();let resolve;h.setHandler(()=>new Promise(r=>{resolve=r}));const pending=h.api.open('USDT','','charge','b');
 assert.match(h.html(),/正在读取订单明细/);assert.doesNotMatch(h.html(),/<table>|当前筛选范围没有已入库记录/);
 resolve({total:3,rows:h.records.b});await pending;assert.match(h.html(),/SYNTHETIC-b-0/);assert.doesNotMatch(h.html(),/正在读取订单明细|当前筛选范围没有已入库记录/);
});

test('WG original transfer type remains readable with raw NULL and explicit zero fee; other sources are not exempted by name',async()=>{
 const h=fixture();h.platforms[1].source='wg';h.L.results[1].groups.provider[0].provider='提现转充值';
 h.records.b=h.records.b.map(r=>({...r,provider:'提现转充值',direction:'charge',channel_type:'提现转充值',raw_provider:null,currency:'VND',fee_exempt:true,fee_version_estimated_amount:'0'}));
 await h.api.open('提现转充值','wg','charge','b');assert.match(h.html(),/WG 原始类型为提现转充值/);assert.match(h.html(),/手续费 0/);assert.match(h.html(),/（空）/);
 h.root.liveProviderOrder(0);assert.match(h.html(),/0（提现转充值）/);assert.match(h.html(),/原始类型/);assert.match(h.html(),/（空）/);
 assert.doesNotMatch(h.api.reason({platform:{source:'ar'},provider:'提现转充值',direction:'charge',channel_type:'提现转充值',raw_provider:null,fee_exempt:true}),/手续费 0|内部转账/);
});


test('DUOLI provider success drilldown labels the order update timestamp while other source columns stay unchanged',async()=>{
 const h=fixture();h.platforms[0].source='duoli';h.platforms[0].capabilities={successTimeBasis:'order_updated_at',chargeSuccessTimeAvailable:true,withdrawSuccessTimeAvailable:true,paymentSuccessTimeAvailable:false,latencyAvailable:false};await h.api.open('USDT','','charge','a');assert.equal(h.requests.at(-1).status,'success');assert.match(h.html(),/成功统计时间（多利按更新时间）/);h.root.liveProviderOrder(0);assert.match(h.html(),/成功统计时间（订单更新时间）/);await h.root.liveProviderOrderPlatform('b');assert.doesNotMatch(h.html(),/订单更新时间/);assert.match(h.html(),/成功时间/);
});
