const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8');
const P={id:'11111111-1111-4111-8111-111111111111',name:'91CLUB',source:'ar',country:'印度',scopeGroup:'IN',currency:'INR',timezone:'Asia/Kolkata',sourceName:'91CLUB'},Q={...P,id:'22222222-2222-4222-8222-222222222222',name:'55CLUB',sourceName:'55CLUB'};
const day=q=>new Date(Date.parse(q.startAt)+330*60000).toISOString().slice(0,10),tick=()=>new Promise(r=>setImmediate(r));
function aggregate(p,n=100){const row=(direction,count,success)=>({direction,currency:p.currency,all_count:count,all_amount:String(count*100),success_count:success,success_amount:String(success*100)});const summary=[row('charge',n,n*.5),row('withdraw',n,n*.8)];return {platform:p,summary,groups:{provider:summary.map(r=>({...r,provider:'Pay'}))}};}
function tickets(p,d,n=10,covered=true){return {startDate:d,endDate:d,summary:{submittedCount:n,submittedAmount:n*100,successCount:n*.5,successAmount:n*50},byPlatformProvider:n?[{platformId:p.id,source:p.source,country:p.country,provider:'Pay',direction:'charge',submittedCount:n,submittedAmount:n*100,successCount:n*.5,successAmount:n*50,uniqueOrderCount:1,uniqueSuccessCount:1}]:[],coverage:{complete:covered,platforms:[{platformId:p.id,days:covered?1:0,expectedDays:1,complete:covered}]},rows:[{submittedCount:999999}]};}
function harness(options={}){
 const platforms=options.platforms||[P,Q],calls=[],workCalls=[],state={page:'daily_comparison'},L={serial:0,from:(options.date||'2026-10-03')+'T00:00:00',to:(options.date||'2026-10-03')+'T23:59:59',country:'印度',currency:'INR',team:'M8',source:'all',dirty:true,feeLookupRows:[{provider:'Pay',scopeType:'country',country:'印度',collectFee:'4%',payoutFee:'2%'}],feeLookupLoading:false};
 class DateFixed extends Date{constructor(...args){super(...(args.length?args:['2026-10-04T04:30:00Z']));}static now(){return Date.parse('2026-10-04T04:30:00Z');}}
 const context={console,Intl,Date:DateFixed,Map,Set,Number,JSON,Math,Promise,setTimeout,clearTimeout};context.window=context;vm.createContext(context);for(const name of ['live-comparison.js','live-provider-summary.js','live-daily-comparison.js'])vm.runInContext(read(name),context,{filename:name});
 let handler=options.handler||((q)=>aggregate(platforms.find(p=>p.id===q.platformId),q.platformId===P.id?100:50)),workHandler=options.workHandler||((q)=>tickets(platforms.find(p=>q.platforms.includes(p.name)),q.startAt.slice(0,10))),inflight=0,max=0,renders=0,fees=0;
 const module=context.HensemLiveDailyComparison.create({L,getPage:()=>state.page,selected:()=>platforms,nativePlatforms:()=>options.native||platforms,activeValues:()=>[],scopeZone:()=>P.timezone,roleAllowed:action=>options.permission?options.permission(action):true,render:()=>renders++,ensureFeeLookup:()=>{fees++;},localClock:(now)=>new Date(Number(now)+330*60000).toISOString().slice(0,19),instant:(value,zone,end)=>new Date(Date.parse(value+'+05:30')+(end?1000:0)).toISOString(),readAggregate:async(q)=>{calls.push({...q});max=Math.max(max,++inflight);try{return await handler(q);}finally{inflight--;}},request:async q=>{workCalls.push({...q});max=Math.max(max,++inflight);try{return await workHandler(q);}finally{inflight--;}}});
 return {module,c:context,L,state,calls,workCalls,setHandler:f=>handler=f,setWorkHandler:f=>workHandler=f,get max(){return max},get renders(){return renders},get fees(){return fees}};
}
test('real daily provider requests share charge/payout, use at most two workers and one baseline day',async()=>{
 const h=harness();assert.equal(h.calls.length,0);await h.module.load(true);assert.equal(h.calls.length,16);assert(h.max<=2);assert(h.calls.every(q=>q.action==='aggregate'&&q.view==='providers'&&q.direction==='all'&&q.currency==='INR'));assert.deepEqual(h.calls.slice(0,4).map(q=>day(q)),['2026-10-03','2026-10-03','2026-10-02','2026-10-02']);assert.equal(new Set(h.calls.map(day)).size,8);assert.equal(h.workCalls.length,0);assert.equal(h.module.model().rows[0].name,'91CLUB');assert.match(h.module.render(),/金额较前日/);assert.match(h.module.render(),/笔数较前日/);assert.equal((h.module.render().match(/2026-09-26<\/td>/g)||[]).length,0,'baseline is not a visible history day');
});
test('inline drilldown, selected-entity trends, sorting and direction changes use existing facts',async()=>{
 const h=harness();await h.module.load();const before=h.calls.length;h.c.liveDailyExpand(0);assert.match(h.module.render(),/daily-inline/);assert.match(h.module.render(),/Pay/);h.c.liveDailyTrend(1);assert.match(h.module.render(),/55CLUB · 7 天趋势/);h.c.liveDailyTrend(-1);assert.match(h.module.render(),/全部所选平台 · 7 天趋势/);h.c.liveDailyDimension('provider');assert.equal(h.module.model().rows[0].now.all_count,150);h.c.liveDailyExpand(0);assert.match(h.module.render(),/91CLUB/);h.c.liveDailyDirection('withdraw');assert.equal(h.module.model().now.success_count,120);assert.equal(h.calls.length,before);assert.equal(h.module.model().now.all_amount,15000);assert(h.module.exportRows().some(row=>row.includes('参考手续费')));
});
test('known zero stays zero, failed/missing currency/metrics stay unknown and WG success time is unavailable',async()=>{
 const h=harness({handler:q=>{const p=q.platformId===P.id?P:Q;if(p===Q)throw Error('fixture read failed');return {platform:p,summary:[],groups:{provider:[]}};}});await h.module.load();const m=h.module.model();assert.equal(m.rows.find(r=>r.key===P.id).now.all_count,0);assert.equal(m.rows.find(r=>r.key===Q.id).now.all_count,null);assert.match(h.module.render(),/fixture read failed/);assert.equal(m.now.all_count,0);assert.equal(m.now.partial,true);
 const wg={...P,source:'wg'},w=harness({platforms:[wg]});await w.module.load();w.c.liveDailyDirection('withdraw');assert.equal(w.module.model().now.success_count,null);assert.equal(w.module.model().now.all_count,100);assert.match(w.module.render(),/—/);
 const missing=harness({platforms:[P],handler:()=>{const r=aggregate(P);r.summary[0].all_amount=null;r.groups.provider[0].all_amount=null;return r;}});await missing.module.load();assert.equal(missing.module.model().now.all_amount,null);assert.equal(missing.module.model().now.all_count,100);
});
test('comparison totals use the same native platform intersection and groups retain partial attribution',async()=>{
 const h=harness({handler:q=>{const p=q.platformId===P.id?P:Q;if(p===Q&&day(q)==='2026-10-02')throw Error('prior failed');const r=aggregate(p,p===P?100:50);if(p===P)r.groups.provider[0].all_count=60;return r;}});await h.module.load();const m=h.module.model();assert.equal(m.now.all_count,150);assert.equal(m.comparison.count,1);assert.equal(m.comparison.current.all_count,100);assert.equal(m.comparison.previous.all_count,100);h.c.liveDailyDimension('provider');assert.equal(h.module.model().rows[0].now.partial,true);assert.match(h.module.render(),/可比 1 个/);
});
test('today payment comparisons use the same clock while history retains whole prior days',async()=>{
 const h=harness({date:'2026-10-04',platforms:[P]});await h.module.load();const prior=h.calls.filter(q=>day(q)==='2026-10-03');assert.equal(prior.length,2);assert(prior.some(q=>q.endAt==='2026-10-03T04:30:01.000Z'));assert(prior.some(q=>q.endAt==='2026-10-03T18:30:00.000Z'));assert.match(h.module.render(),/趋势历史日全天/);assert.match(h.module.render(),/今日尚未结束/);
});
test('raw workorders are explicit, use native-scoped summary rather than paged or unique rows, and need coverage for zero',async()=>{
 const h=harness({platforms:[P]});h.c.liveDailyDirection('workorder');await h.module.load();assert.equal(h.calls.length,0);assert.equal(h.workCalls.length,8);assert.equal(h.module.model().now.all_count,10);assert.equal(h.module.model().now.success_count,5);assert.equal(h.module.model().now.all_amount,1000);assert.match(h.module.render(),/原始工单不去重/);assert(h.workCalls.every(q=>!('platformId'in q)&&q.platforms.includes(P.name)));
 const absent=harness({platforms:[P],workHandler:q=>tickets(P,q.startAt.slice(0,10),0,false)});absent.c.liveDailyDirection('workorder');await absent.module.load();assert.equal(absent.module.model().now.all_count,null);assert.match(absent.module.render(),/不能确认零/);
 const zero=harness({platforms:[P],workHandler:q=>tickets(P,q.startAt.slice(0,10),0,true)});zero.c.liveDailyDirection('workorder');await zero.module.load();assert.equal(zero.module.model().now.all_count,0);
});
test('today workorders suppress day-over-day comparison and wrong native coverage cannot attach to the row',async()=>{
 const h=harness({date:'2026-10-04',platforms:[P]});h.c.liveDailyDirection('workorder');await h.module.load();assert.equal(h.module.model().comparison.count,0);assert.equal(h.module.model().comparison.current.all_count,null);assert.match(h.module.render(),/工单无同进度接口/);
 const wrong=harness({platforms:[P],workHandler:q=>({...tickets(P,q.startAt.slice(0,10)),coverage:{platforms:[{platformId:Q.id,complete:true,days:1,expectedDays:1}]}})});wrong.c.liveDailyDirection('workorder');await wrong.module.load();assert.equal(wrong.module.model().now.all_count,null);
});
test('failed requests resume without refetching completed days; restore makes no automatic request',async()=>{
 let failed=true;const h=harness({platforms:[P],handler:q=>{if(day(q)==='2026-10-01'&&failed)throw Error('once');return aggregate(P);}});await h.module.load();assert.equal(h.calls.length,8);const saved=h.module.capture();h.module.cancel();h.module.restore(saved);assert.equal(h.calls.length,8);failed=false;await h.module.load(false);assert.equal(h.calls.length,9);assert.equal(h.module.capture().status,'ready');assert.equal(h.calls.at(-1).startAt,'2026-09-30T18:30:00.000Z');
});
test('navigation cancellation, dirty edits and revoked detail/export permission block stale work',async()=>{
 const releases=[];const h=harness({handler:q=>new Promise(r=>releases.push(()=>r(aggregate(q.platformId===P.id?P:Q))))}),promise=h.module.load();await tick();assert.equal(h.calls.length,2);h.state.page='overview';h.module.cancel();releases.forEach(r=>r());await promise;assert.equal(h.calls.length,2);assert.equal(h.module.canExport(),false);
 const noDetail=harness({permission:action=>!['detail','export'].includes(action)});await noDetail.module.load();noDetail.c.liveDailyExpand(0);assert.doesNotMatch(noDetail.module.render(),/daily-inline/);assert.equal(noDetail.module.exportRows().length,0);noDetail.L.dirty=true;assert.equal(noDetail.module.model(),null);assert.match(noDetail.module.render(),/筛选条件已修改/);
});
test('incomplete workorder days retain counts but cannot masquerade as day-over-day decline',async()=>{
 const h=harness({platforms:[P],workHandler:q=>tickets(P,q.startAt.slice(0,10),q.startAt.startsWith('2026-10-03')?20:100,!q.startAt.startsWith('2026-10-03'))});h.c.liveDailyDirection('workorder');await h.module.load();const m=h.module.model();assert.equal(m.now.all_count,20);assert.equal(m.now.partial,true);assert.equal(m.comparison.count,0);assert.equal(m.comparison.current.all_count,null);assert.doesNotMatch(h.module.render(),/-80\.00%/);
 const grouped=harness({platforms:[P],workHandler:q=>{const r=tickets(P,q.startAt.slice(0,10),100);r.byPlatformProvider[0].submittedCount=60;return r;}});grouped.c.liveDailyDirection('workorder');await grouped.module.load();assert.equal(grouped.module.model().comparison.count,1,'authoritative complete platform summary remains comparable');grouped.c.liveDailyDimension('provider');assert.equal(grouped.module.model().rows[0].now.all_count,60);assert.equal(grouped.module.model().rows[0].now.partial,true);assert.equal(grouped.module.model().rows[0].comparison.count,0);
});
test('every aggregate segment must belong to the requested native platform and cover the exact interval',async()=>{
 const segmented=(q,corrupt)=>{const middle=new Date((Date.parse(q.startAt)+Date.parse(q.endAt))/2).toISOString(),a={...aggregate(P,50),startAt:q.startAt,endAt:middle},b={...aggregate(P,50),startAt:middle,endAt:q.endAt};if(corrupt==='identity')b.platform=Q;if(corrupt==='gap')b.startAt=new Date(Date.parse(middle)+1000).toISOString();return {...aggregate(P),_parts:[a,b]};};
 const good=harness({platforms:[P],handler:q=>segmented(q)});await good.module.load();assert.equal(good.module.model().now.all_count,100);assert.equal(good.module.capture().payments['2026-10-03'][P.id].response._parts,undefined);
 for(const corrupt of ['identity','gap']){const h=harness({platforms:[P],handler:q=>segmented(q,corrupt)});await h.module.load();assert.equal(h.module.model().now.all_count,null);assert.equal(h.module.capture().status,'partial');}
});
test('CSV includes visible inline native-platform breakdown and selected daily history with distinct changes',async()=>{
 const h=harness();await h.module.load();h.c.liveDailyDimension('provider');h.c.liveDailyExpand(0);const rows=h.module.exportRows();assert(rows.some(r=>r[0]==='↳ 91CLUB'));assert(rows.some(r=>r[0]==='↳ 55CLUB'));assert(rows.some(r=>r.includes('全部金额较前日')&&r.includes('全部笔数较前日')));assert(rows.some(r=>r[0]==='Pay'&&r[1]==='7天趋势'));assert.equal(rows.filter(r=>/^2026-\d\d-\d\d$/.test(r[0])).length,7);assert.equal(rows.some(r=>r.some(v=>/<[^>]+>/.test(v))),false);
});
test('native GAME66 identity remains separate from normalized display country in segmented results and fees',async()=>{
 const p={...P,name:'66GAME',source:'game66',sourceName:'66GAME',identityCountry:'红膏蟹',rawCountry:'红膏蟹'},raw={...p,country:'红膏蟹'};
 const h=harness({platforms:[p],handler:q=>{const r=aggregate(p),part={...aggregate(raw),startAt:q.startAt,endAt:q.endAt};r.groups.provider=r.groups.provider.map(row=>({...row,platformId:p.id,platform:p.name,source:p.source,country:raw.country,nativeFeeIdentityVerified:true}));return {...r,_parts:[part]};}});await h.module.load();assert.equal(h.module.model().now.all_count,100);assert.equal(h.module.model().now.leaves[0].nativeFeeIdentityVerified,true);assert.equal(h.module.model().now.leaves[0].country,'印度');assert.match(h.module.render(),/200\.00/);
 const invalid=harness({platforms:[p],handler:q=>({...aggregate(p),_parts:[{...aggregate({...raw,country:'其他'}),startAt:q.startAt,endAt:q.endAt}]})});await invalid.module.load();assert.equal(invalid.module.model().now.all_count,null);
});
test('revoking detail after expansion hides and stops exporting restored children',async()=>{
 let detail=true;const h=harness({permission:action=>action!=='detail'||detail});await h.module.load();h.c.liveDailyExpand(0);const saved=h.module.capture();assert.match(h.module.render(),/daily-inline/);detail=false;h.module.restore(saved);assert.doesNotMatch(h.module.render(),/daily-inline/);assert.equal(h.module.exportRows().some(r=>r[0]?.startsWith('↳ ')),false);
});

const plain=value=>String(value).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
function withFacts(p,facts){const result=aggregate(p);result.summary=result.summary.map(row=>({...row,...facts}));result.groups.provider=result.summary.map(row=>({...row,provider:'Pay'}));return result;}
function historyView(h){
 const table=h.module.render().match(/<table\b[^>]*class="[^"]*\bdaily-history\b[^"]*"[^>]*>([\s\S]*?)<\/table>/)?.[1];assert(table,'daily history table is visible');
 const parse=section=>[...table.match(new RegExp('<'+section+'>([\\s\\S]*?)<\\/'+section+'>'))[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/<td\b[^>]*data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>[plain(cell[1]),plain(cell[2])])));
 return {rows:parse('tbody'),footer:parse('tfoot')[0]};
}
function csvHistory(h){const rows=h.module.exportRows(),at=rows.findIndex(row=>row[0]==='日期'),heads=rows[at];assert(at>=0);return {heads,rows:Array.from(rows.slice(at+1),row=>Object.fromEntries(heads.map((head,i)=>[head,row[i]])))};}

test('daily detail gives each of the four amount and count metrics its own share denominator without more reads',async()=>{
 const a={all_amount:10000,all_count:75,success_amount:4000,success_count:10},b={all_amount:30000,all_count:25,success_amount:16000,success_count:90};
 const h=harness({handler:q=>withFacts(q.platformId===P.id?P:Q,q.platformId===P.id?a:b)});await h.module.load();const reads=h.calls.length,view=historyView(h),row=view.rows[0];
 assert.equal(row['全部金额'],'10,000.00');assert.equal(row['全部笔数'],'75');assert.equal(row['成功金额'],'4,000.00');assert.equal(row['成功笔数'],'10');
 assert.equal(row['全部金额占比'],'25.00%');assert.equal(row['全部笔数占比'],'75.00%');assert.equal(row['成功金额占比'],'20.00%');assert.equal(row['成功笔数占比'],'10.00%');
 const csv=h.module.exportRows(),heads=csv[1],platform=csv.find(row=>row[0]==='91CLUB');assert.equal(heads.length,18);assert.equal(platform[heads.indexOf('成功金额')],'4,000.00');assert.equal(platform[heads.indexOf('成功笔数占比')],'10.00%');
 h.c.liveDailyExpand(0);h.c.liveDailySort('all_amount');h.c.liveDailyDirection('withdraw');h.c.liveDailyDimension('provider');h.module.render();h.module.exportRows();assert.equal(h.calls.length,reads,'detail, sorting, business switch and export reuse the queried daily facts');
});

test('new success changes compare only the same available native platforms across both dates',async()=>{
 const h=harness({handler:q=>{const current=day(q)==='2026-10-03',p=q.platformId===P.id?P:Q;if(p===Q&&!current)throw Error('prior not available');return withFacts(p,p===Q?{all_amount:90000,all_count:900,success_amount:9000,success_count:500}:current?{all_amount:2000,all_count:20,success_amount:300,success_count:12}:{all_amount:1000,all_count:10,success_amount:200,success_count:8});}});
 await h.module.load();h.c.liveDailyTrend(-1);const row=historyView(h).rows[0];assert.equal(row['成功金额'],'9,300.00');assert.equal(row['成功笔数'],'512');assert.equal(row['成功金额较前日'],'+50.00%');assert.equal(row['成功笔数较前日'],'+50.00%');assert.equal(row['全部金额较前日'],'+100.00%');
 const m=h.module.model();assert.equal(m.comparison.count,1);const csv=h.module.exportRows(),heads=csv[1],total=csv.find(row=>row[0]==='已读汇总');assert.equal(total[heads.indexOf('成功金额涨跌')],'+50.00%');assert.equal(total[heads.indexOf('成功笔数涨跌')],'+50.00%');
});

test('unknown success amounts stay unknown independently of known success counts and real zero',async()=>{
 const h=harness({platforms:[P],handler:q=>withFacts(P,{all_amount:1000,all_count:10,success_amount:day(q)==='2026-10-03'?null:0,success_count:day(q)==='2026-10-03'?5:0})});await h.module.load();const view=historyView(h),current=view.rows[0],previous=view.rows[1];
 assert.equal(current['成功金额'],'—');assert.equal(current['成功金额占比'],'—');assert.equal(current['成功金额较前日'],'—');assert.equal(current['成功笔数'],'5');assert.equal(current['成功笔数占比'],'100.00%');assert.equal(current['成功率'],'50.00%');
 assert.equal(previous['成功金额'],'0.00');assert.equal(previous['成功笔数'],'0');assert.equal(previous['成功金额占比'],'—','zero divided by zero is not a known share');assert.equal(view.footer['成功金额'],'—');assert.equal(view.footer['成功笔数'],'5');
 const wg=harness({platforms:[{...P,source:'wg'}]});await wg.module.load();wg.c.liveDailyDirection('withdraw');const payout=historyView(wg).rows[0];assert.equal(payout['全部金额'],'10,000.00');assert.equal(payout['成功金额'],'—');assert.equal(payout['成功笔数'],'—');assert.equal(payout['成功率'],'—');
});

test('daily history footer totals successful amounts and counts and computes a weighted success rate',async()=>{
 const h=harness({platforms:[P],handler:q=>withFacts(P,day(q)==='2026-10-03'?{all_amount:1000,all_count:10,success_amount:800,success_count:8}:day(q)==='2026-10-02'?{all_amount:6000,all_count:30,success_amount:3000,success_count:15}:{all_amount:0,all_count:0,success_amount:0,success_count:0})});await h.module.load();const {footer}=historyView(h);
 assert.equal(footer['全部金额'],'7,000.00');assert.equal(footer['全部笔数'],'40');assert.equal(footer['成功金额'],'3,800.00');assert.equal(footer['成功笔数'],'23');assert.equal(footer['成功率'],'57.50%','23 / 40, not the mean of 80% and 50%');assert.equal(footer['成功金额占比'],'100.00%');assert.equal(footer['成功笔数占比'],'100.00%');
 for(const key of ['全部金额较前日','全部笔数较前日','成功金额较前日','成功笔数较前日','变化（百分点）'])assert.equal(footer[key],'—','period footer has no single-day change: '+key);
});

test('today history suppresses new success changes and CSV includes exactly the visible history plus its footer',async()=>{
 const h=harness({date:'2026-10-04',platforms:[P],handler:q=>withFacts(P,day(q)==='2026-10-04'?{all_amount:3000,all_count:30,success_amount:2700,success_count:27}:{all_amount:1000,all_count:10,success_amount:400,success_count:4})});await h.module.load();const view=historyView(h),current=view.rows[0],csv=csvHistory(h);
 for(const key of ['全部金额较前日','全部笔数较前日','成功金额较前日','成功笔数较前日','变化（百分点）'])assert.equal(current[key],'—','unfinished day must not compare with prior full day: '+key);
 assert.equal(current['成功金额'],'2,700.00');assert.equal(current['成功笔数'],'27');assert.equal(csv.heads.length,17);assert.equal(csv.rows.length,8);assert.deepEqual(csv.rows,[...view.rows,view.footer]);assert.equal(csv.rows[0]['日期'],'2026-10-04','today remains a plain ISO date in CSV');assert(csv.rows.slice(0,-1).every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row['日期'])));assert.equal(csv.rows.at(-1)['日期'],'7天汇总');
 assert.equal(h.calls.length,9,'today still uses only its same-clock comparison plus the existing history/baseline reads');
});

test('workorder daily details preserve handled metrics and exclude incomplete-day changes',async()=>{
 const h=harness({platforms:[P],workHandler:q=>tickets(P,q.startAt.slice(0,10),q.startAt.startsWith('2026-10-03')?20:100,!q.startAt.startsWith('2026-10-03'))});h.c.liveDailyDirection('workorder');await h.module.load();const row=historyView(h).rows[0],csv=csvHistory(h);
 assert.equal(row['已处理金额'],'1,000.00');assert.equal(row['已处理笔数'],'10');assert.equal(row['处理率'],'50.00%');assert.equal(row['已处理金额较前日'],'—');assert.equal(row['已处理笔数较前日'],'—');assert.equal(row['参考手续费'],'—');assert(!('成功金额'in row));assert(csv.heads.includes('已处理金额'));assert(csv.heads.includes('已处理笔数'));assert.equal(h.calls.length,0);
});
