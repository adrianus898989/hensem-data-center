const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../admin-preview/live-analysis-drilldown.js'),'utf8');
const E=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const metric=(a=100,c=10,s=70,n=7)=>({direction:'charge',currency:'INR',all_amount:a,all_count:c,created_success_count:4,success_amount:s,success_count:n,pending_amount:20,pending_count:2,failed_amount:10,failed_count:1,rejected_amount:0,rejected_count:0,unknown_amount:0,unknown_count:0});
const segment={kind:'hourly',direction:'charge',hour:8};
function setup(request){const platforms=[{id:'a',name:'SAME',source:'ar',timezone:'Asia/Kolkata',currency:'INR'},{id:'b',name:'SAME',source:'newar',timezone:'Asia/Kolkata',currency:'INR'}],L={serial:1,queryScope:'x',from:'2026-09-20T00:00:00',to:'2026-09-24T23:59:59',currency:'INR',direction:'all',status:'all',catalog:platforms,results:platforms.map((p,i)=>({platform:p,summary:[metric()],groups:{hourly:[{...metric(100,10,i?30:70,i?3:7),hour:8}],amount_range:[{...metric(),bucket:'100–200'}],matrix_range:[{...metric(),bucket:'100–200',hour:8}],latency:[{direction:'charge',currency:'INR',bucket:0,count:i?2:8,amount:i?20:80}],latency_thresholds:[{direction:'charge',currency:'INR',bucket:0,threshold_ms:300000,count:2,amount:20}]}}))};let calls=[],renders=0;const root={};vm.runInNewContext(code,{window:root,console,Intl,Date});const instance=root.HensemAnalysisDrilldown.create({L,E,N:n=>n==null?'—':Number(n).toFixed(2),C:n=>String(n),R:(n,d)=>d>0?(n/d*100).toFixed(2)+'%':'—',query:p=>({action:'aggregate',platformId:p.id,startAt:'2026-09-19T18:30:00Z',endAt:'2026-09-24T18:30:00Z',status:'all',providers:['ORIGINAL'],currency:'INR'}),request:q=>{calls.push(q);return request?request(q):Promise.resolve({complete:true,hasMore:false,summary:[],groups:{daily:[{...metric(),date:'2026-09-20'}]}})},render:()=>renders++});const action=(s,op,value)=>root.liveAnalysisAction(encodeURIComponent(JSON.stringify(s)),op,value===undefined?undefined:encodeURIComponent(value));return {root,L,instance,action,calls,get renders(){return renders}}}
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r))};
test('daily comparison presents exact amount difference plus percent and preserves zero and unknown baselines',async()=>{
 const h=setup(q=>Promise.resolve({complete:true,hasMore:false,summary:[],groups:{daily:[{...metric(100,10,0,0),date:'2026-09-20'},{...metric(100,10,50,5),date:'2026-09-21'},{...metric(100,10,75,5),date:'2026-09-22'},{...metric(100,10,null,5),date:'2026-09-23'}]}}));
 h.instance.open(segment,'8时');h.action(segment,'daily');await flush();const html=h.instance.panel(segment);
 assert.match(html,/\+100\.00<small class="analysis-metric-share">无基数/);assert.match(html,/\+50\.00<small class="analysis-metric-share">\+50\.00%/);
 const last=[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].filter(x=>/2026-09-23|2026-09-24/.test(x[1]));assert(last.every(x=>/<td>—<\/td>$/.test(x[1])));
 assert.equal(h.calls.length,2);
});
test('platform expansion stays local, keeps same-name sources distinct and uses segment denominators',()=>{const h=setup();h.instance.button(segment,'8时');h.action(segment,'toggle');const html=h.instance.panel(segment);assert.equal(h.calls.length,0);assert.match(html,/70\.00%/);assert.match(html,/30\.00%/);assert.match(html,/>ar</);assert.match(html,/>newar</);assert.match(html,/<td>70\.00%<\/td>/);assert.doesNotMatch(html,/<td>40\.00%<\/td>/);assert.equal(h.instance.platformRows(segment).length,2);});
test('missing amounts and unavailable latency direction stay unknown, never zero success',()=>{const h=setup();h.L.results[0].groups.hourly[0].success_amount=null;h.instance.open(segment,'8时');const html=h.instance.panel(segment);assert.match(html,/—/);const cells=[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].slice(1).map(m=>[...m[1].matchAll(/<td>(.*?)<\/td>/gs)].map(x=>x[1]));assert(cells.every(row=>/金额占比 —/.test(row[2])));h.L.results[0].groups.latency=[{direction:'withdraw',bucket:0,count:1,amount:1}];const row=h.instance.platformRows({kind:'latency',direction:'charge',bucket:0}).find(r=>r.platformId==='a');assert.equal(row.success_count,null);assert.equal(row.success_amount,null);});
test('latency and cross-segment matches exclude other hours and directions',()=>{const h=setup();h.L.results[0].groups.matrix_range.push({...metric(9000,900,9000,900),hour:9,bucket:'100–200'});const rows=h.instance.platformRows({kind:'matrix_range',direction:'charge',hour:8,bucket:'100–200'});assert.equal(rows[0].all_count,10);const latency=h.instance.platformRows({kind:'latency',direction:'charge',bucket:0,cumulative:true});assert.equal(latency[0].success_count,2);});
test('single-day expansion does not offer daily comparison and escapes source labels',()=>{const h=setup();h.L.to='2026-09-20T23:59:59';h.L.results[0].platform.name='<script>alert(1)</script>';h.instance.open(segment,'<img>');const html=h.instance.panel(segment);assert.doesNotMatch(html,/每日对比|查看每天|<script>|<img>/);assert.match(html,/&lt;script&gt;/);assert.equal(h.calls.length,0);});
test('daily comparison queries one range per platform, caches results and shows every selected day',async()=>{const h=setup();h.instance.open(segment,'8时');h.action(segment,'daily');await flush();assert.equal(h.calls.length,2);assert(h.calls.every(q=>q.view==='drilldown'&&q.kind==='hourly'&&q.hour===8&&q.providers[0]==='ORIGINAL'));const html=h.instance.panel(segment);for(let d=20;d<=24;d++)assert.match(html,new RegExp('2026-09-'+d));h.action(segment,'platform');h.action(segment,'daily');await flush();assert.equal(h.calls.length,2);});
test('choosing one platform first requests only that platform and preserves partial-day bounds',async()=>{const h=setup();h.instance.open(segment,'8时');h.action(segment,'platformDaily','b');await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].platformId,'b');assert.equal(h.calls[0].startAt,'2026-09-19T18:30:00Z');});
test('failed daily results remain partial and retry only failed platform',async()=>{let failed=true;const h=setup(q=>q.platformId==='b'&&failed?Promise.reject(Error('timeout')):Promise.resolve({complete:true,hasMore:false,summary:[],groups:{daily:[{...metric(),date:'2026-09-20'}]}}));h.instance.open(segment,'8时');h.action(segment,'daily');await flush();assert.match(h.instance.panel(segment),/每日对比尚不完整/);failed=false;h.action(segment,'retry');await flush();assert.equal(h.calls.length,3);assert.equal(h.calls[2].platformId,'b');assert.doesNotMatch(h.instance.panel(segment),/每日对比尚不完整/);});
test('old async results cannot refill a new query scope',async()=>{let resolve;const h=setup(()=>new Promise(r=>{resolve=r}));h.instance.open(segment,'8时');h.action(segment,'daily');h.L.serial=2;h.L.results=[];h.instance.table({headers:[],rows:[],cells:()=>[],segment:()=>segment,label:()=>''});resolve({complete:true,hasMore:false,summary:[],groups:{daily:[{...metric(99999),date:'2026-09-20'}]}});await flush();assert.equal(h.instance.snapshot().states.size,0);assert.doesNotMatch(h.instance.panel(segment),/99999/);});
test('closing an unrelated expansion does not cancel the active daily request',async()=>{const waiting=[];const h=setup(()=>new Promise(r=>waiting.push(r)));h.instance.open(segment,'8时');h.action(segment,'daily');const other={...segment,hour:9};h.instance.open(other,'9时');h.action(other,'toggle');waiting.forEach(r=>r({complete:true,hasMore:false,summary:[],groups:{daily:[]}}));await flush();const s=h.instance.snapshot().states.get(JSON.stringify(segment));assert.equal(s.daily.get('all').loading,false);assert.equal(s.daily.get('all').results.size,2);});
test('tables keep all main rows operable after more than 32 segment buttons render',()=>{const h=setup();const rows=Array.from({length:48},(_,i)=>({kind:'hourly',direction:i<24?'charge':'withdraw',hour:i%24}));h.instance.table({id:'many',headers:['时段'],rows,cells:r=>[r.hour],segment:r=>r,label:r=>r.hour+'时'});h.action(rows[0],'toggle');assert.match(h.instance.panel(rows[0]),/analysis-drilldown/);assert.equal(h.calls.length,0);});
test('switching daily ranges never runs more than two actual requests and skips stale queued work',async()=>{const waiting=[];const h=setup(q=>new Promise(resolve=>waiting.push({q,resolve})));h.instance.open(segment,'8时');h.action(segment,'daily');assert.equal(h.calls.length,2);const second={...segment,hour:9},third={...segment,hour:10};h.instance.open(second,'9时');h.action(second,'daily');h.instance.open(third,'10时');h.action(third,'daily');assert.equal(h.calls.length,2);waiting.slice(0,2).forEach(x=>x.resolve({complete:true,hasMore:false,summary:[],groups:{daily:[]}}));await flush();assert.equal(h.calls.length,4);assert(h.calls.slice(2).every(q=>q.hour===10));waiting.slice(2).forEach(x=>x.resolve({complete:true,hasMore:false,summary:[],groups:{daily:[]}}));await flush();});

const businessHeaders=['全部金额','全部笔数','成功金额','成功笔数','处理中金额','处理中笔数','失败金额','失败笔数','成功率'];
const alignedConfig={aligned:true,headers:['方向','时段',...businessHeaders],rows:[segment],cells:()=>['代收','08:00–08:59:59',100,10,70,7,20,2,10,1,'70.00%'],segment:r=>r,label:()=> '08:00–08:59:59'};
test('hour and amount platform rows share parent columns and put shares under success metrics',()=>{const h=setup();h.instance.open(segment,'8时');const html=h.instance.table(alignedConfig);assert.equal((html.match(/<table>/g)||[]).length,1);assert.match(html,/analysis-aligned-table/);const main=html.match(/<thead><tr>(.*?)<\/tr>/s)[1],detail=html.match(/<tr class="analysis-aligned-head">(.*?)<\/tr>/s)[1];assert.equal((main.match(/<th/g)||[]).length,12);assert.equal((detail.match(/<th/g)||[]).length,12);assert.match(detail,/平台<\/th><th scope="col">包网<\/th><th scope="col">全部金额/);assert.doesNotMatch(detail,/>金额占比<|>笔数占比</);const rows=[...html.matchAll(/<tr class="analysis-aligned-item">(.*?)<\/tr>/gs)];assert.equal(rows.length,2);for(const row of rows){const cells=[...row[1].matchAll(/<td>(.*?)<\/td>/gs)].map(x=>x[1]);assert.equal(cells.length,12);assert.match(cells[4],/analysis-metric-value.*analysis-metric-share/s);assert.match(cells[5],/笔数占比/);}assert.equal(h.calls.length,0);});
test('daily comparison missing dates stay unknown and shares do not add misaligned columns',async()=>{const h=setup();h.instance.open(segment,'8时');h.action(segment,'daily');await flush();const html=h.instance.table(alignedConfig),rows=[...html.matchAll(/<tr class="analysis-aligned-item">(.*?)<\/tr>/gs)].map(x=>[...x[1].matchAll(/<td>(.*?)<\/td>/gs)].map(c=>c[1]));assert.equal(rows.length,5);assert(rows.every(row=>row.length===12));assert.equal(rows[0][0],'2026-09-20');assert.equal(rows[1][0],'2026-09-21');assert.equal(rows[1][1],'未返回记录');assert(rows[1].slice(2).every(x=>x==='—'));assert.match(html,/不补成 0/);});
test('partial daily platform coverage is labelled and never compared as a complete day',async()=>{const h=setup(q=>Promise.resolve({complete:true,hasMore:false,summary:[],groups:{daily:q.platformId==='a'?[{...metric(),date:'2026-09-20'},{...metric(),date:'2026-09-21'}]:[]}}));h.instance.open(segment,'8时');h.action(segment,'daily');await flush();const html=h.instance.table(alignedConfig);assert.match(html,/1 \/ 2 平台有记录/);const rows=[...html.matchAll(/<tr class="analysis-aligned-item">(.*?)<\/tr>/gs)];for(const row of rows.slice(0,2))assert.match(row[1],/<td>—<\/td>$/);});
test('matrix cell expansion appears immediately below its amount row with hour-specific totals',()=>{const h=setup(),selected={kind:'matrix_range',direction:'charge',hour:8,bucket:'100–200'},aggregate={kind:'amount_range',direction:'charge',bucket:'100–200'},config={exclusive:'matrix-charge',headers:['金额 / 时','08时'],rows:['100–200','201–300'],cells:b=>[b,'hour cell'],segment:bucket=>({kind:'amount_range',direction:'charge',bucket}),label:bucket=>bucket+' · 24小时合计',rowDetail:bucket=>bucket===selected.bucket?{segment:selected,label:'08时 × '+bucket}:null};h.instance.table(config);h.instance.open(selected,'08时 × 100–200','matrix-charge');let html=h.instance.table(config);assert.equal(h.instance.isOpen(selected),true);assert(html.indexOf('08时 × 100–200')<html.indexOf('<td>201–300</td>'));assert.match(html,/analysis-matrix-selected-row/);assert.doesNotMatch(html,/<strong>100–200 · 24小时合计/);assert.equal(h.calls.length,0);h.action(aggregate,'toggle');html=h.instance.table(config);assert.equal(h.instance.isOpen(selected),false);assert.match(html,/<strong>100–200 · 24小时合计/);assert.doesNotMatch(html,/<strong>08时 ×/);h.instance.open(selected,'08时 × 100–200','matrix-charge');assert.equal(h.instance.isOpen(aggregate),false);});

const durationSegment={kind:'latency',direction:'charge',bucket:0,cumulative:false};
const cellsOf=html=>[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m=>[...m[1].matchAll(/<td>(.*?)<\/td>/gs)].map(c=>c[1])).filter(row=>row.length);
function durationResponse(q){
 const row=(provider,count,valid_count,amount,date)=>({provider,direction:'charge',currency:'INR',count,valid_count,amount,valid_amount:valid_count*100,success_count:count,success_amount:amount,...(date?{date}:{})});
 const provider=q.platformId==='a'?[row('SLOW',10,100,1000),row('FAST',0,900,0)]:[row('SLOW',30,300,3000),row('FAST',10,100,10000)];
 const provider_daily=q.platformId==='a'?[row('SLOW',2,10,200,'2026-09-20'),row('FAST',0,200,0,'2026-09-20'),row('SLOW',8,90,800,'2026-09-21'),row('FAST',0,700,0,'2026-09-21')]:[row('SLOW',8,40,800,'2026-09-20'),row('FAST',2,50,2000,'2026-09-20'),row('SLOW',22,260,2200,'2026-09-21'),row('FAST',8,50,8000,'2026-09-21')];
 const total=rows=>Object.fromEntries(['count','amount','valid_count','valid_amount'].map(key=>[key,rows.reduce((n,r)=>n+r[key],0)]));
 return {platform:{id:q.platformId},complete:true,hasMore:false,summary:[{direction:'charge',currency:'INR',...total(provider)}],groups:{provider,provider_daily,daily:['2026-09-20','2026-09-21'].map(date=>({date,direction:'charge',currency:'INR',...total(provider_daily.filter(r=>r.date===date))}))},rows:[]};
}
test('each latency band has separate provider and local platform expansion buttons',async()=>{
 const h=setup(q=>Promise.resolve(durationResponse(q))),buttons=h.instance.button(durationSegment,'≤ 5 分钟');
 assert.match(buttons,/三方展开/);assert.match(buttons,/平台展开/);
 h.action(durationSegment,'togglePlatform');assert.equal(h.calls.length,0);assert.match(h.instance.panel(durationSegment),/>ar</);assert.match(h.instance.panel(durationSegment),/>newar</);
 h.action(durationSegment,'toggleProvider');await flush();assert.equal(h.calls.length,2);
 assert(h.calls.every(q=>q.view==='drilldown'&&q.kind==='latency'&&q.bucket===0&&q.cumulative===false&&q.direction==='charge'&&q.providers[0]==='ORIGINAL'));
 h.action(durationSegment,'toggleProvider');assert.equal(h.instance.panel(durationSegment),'');h.action(durationSegment,'toggleProvider');await flush();assert.equal(h.calls.length,2,'reopening a complete provider band reuses its aggregate result');
 assert.match(h.instance.button(segment,'8时'),/三方展开/);assert.match(h.instance.button(segment,'8时'),/平台展开/);
});

test('hour and amount provider expansion keeps its precise segment and reuses cached cohorts',async()=>{
 const h=setup(q=>Promise.resolve({complete:true,hasMore:false,summary:[metric()],groups:{daily:[{...metric(),date:'2026-09-20'}],provider:[{...metric(),provider:'Selected-Pay'}],provider_daily:[{...metric(),provider:'Selected-Pay',date:'2026-09-20'}]}}));
 h.instance.button(segment,'08时');h.action(segment,'togglePlatform');assert.equal(h.calls.length,0);h.action(segment,'toggleProvider');await flush();assert.equal(h.calls.length,2);assert(h.calls.every(q=>q.kind==='hourly'&&q.hour===8&&q.providers[0]==='ORIGINAL'));
 let html=h.instance.panel(segment);assert.match(html,/Selected-Pay/);assert.match(html,/全部金额 \/ 笔数/);assert.match(html,/analysis-pair-amount/);assert.match(html,/70\.00%/);h.action(segment,'both');await flush();assert.equal(h.calls.length,2,'historical paired action safely returns to the local platform view');html=h.instance.panel(segment);assert.doesNotMatch(html,/analysis-dual-detail|一起展示/);assert.equal(h.instance.snapshot().states.get(JSON.stringify(segment)).tab,'platform');assert.match(html,/>ar</);assert.match(html,/>newar</);
 h.action(segment,'toggleProvider');await flush();h.action(segment,'toggleProvider');h.action(segment,'toggleProvider');await flush();assert.equal(h.calls.length,2);
});

test('custom provider request has the same independent half-open amount and hour range without bucket leakage',async()=>{
 const h=setup(q=>Promise.resolve({complete:true,hasMore:false,summary:[metric()],groups:{daily:[],provider:[{...metric(),provider:'Range-Pay'}],provider_daily:[]}})),custom={kind:'custom',direction:'charge',amountMin:200,amountMax:250,amountMaxExclusive:true,hourRange:{minHour:2,maxHour:4},placement:'analysis-custom-time'};
 const before=JSON.stringify(h.L.results);h.instance.button(custom,'custom');h.action(custom,'toggleProvider');await flush();assert.equal(h.calls.length,2);
 for(const q of h.calls){assert.equal(q.kind,'custom');assert.equal(q.amountMin,200);assert.equal(q.amountMax,250);assert.equal(q.amountMaxExclusive,true);assert.deepEqual(JSON.parse(JSON.stringify(q.hourRange)),{minHour:2,maxHour:4});assert.equal(q.hour,undefined);assert.equal(q.bucket,undefined);assert.equal(q.placement,undefined);assert.deepEqual(JSON.parse(JSON.stringify(q.providers)),['ORIGINAL'])}
 assert.equal(JSON.stringify(h.L.results),before);assert.match(h.instance.panel(custom),/Range-Pay/);
});

test('partial business provider cohorts show known metrics but never complete shares or a fabricated empty source',async()=>{
 let fail=true;const h=setup(q=>{if(q.platformId==='b'&&fail)return Promise.reject(Error('synthetic range timeout'));const part=metric(100,10,q.platformId==='a'?70:30,q.platformId==='a'?7:3);return Promise.resolve({complete:true,hasMore:false,summary:[part],groups:{daily:[],provider:[{...part,provider:'Known'}],provider_daily:[]}})});h.instance.button(segment,'hour');h.action(segment,'toggleProvider');await flush();let html=h.instance.panel(segment);assert.match(html,/synthetic range timeout/);assert.match(html,/金额占比 —/);assert.match(html,/笔数占比 —/);let row=cellsOf(html)[0];assert.match(row[2],/70\.00/);assert.match(row[2],/7 笔/);assert.equal(row.at(-1),'—','the shared provider may have different success rates on its missing platform; partial 7/10 must not appear as the complete 70%');fail=false;h.action(segment,'retry');await flush();assert.equal(h.calls.length,3);assert.equal(h.calls.at(-1).platformId,'b');html=h.instance.panel(segment);assert.doesNotMatch(html,/synthetic range timeout/);assert.match(html,/金额占比 100\.00%/);row=cellsOf(html)[0];assert.equal(row.at(-1),'50.00%','after both platforms arrive the provider uses 10/20 rather than the first platform 7/10');
});
test('provider shares use the band total while own-band rates use that provider valid orders across platforms',async()=>{
 const h=setup(q=>Promise.resolve(durationResponse(q)));h.L.results.forEach(r=>r.groups.provider=[{provider:'SLOW',...metric(999999,999999,999999,999999)}]);
 const before=JSON.stringify(h.L.results);h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'toggleProvider');await flush();
 const html=h.instance.panel(durationSegment),rows=cellsOf(html);
 assert.deepEqual(rows[0].slice(0,7),['SLOW','4000.00','28.57%','40','80.00%','400','10.00%']);
 assert.deepEqual(rows[1].slice(0,7),['FAST','10000.00','71.43%','10','20.00%','1000','1.00%']);
 assert.match(html,/<th>档内笔数占比<\/th>/);assert.match(html,/title="该三方区间内成功笔数 ÷ 该三方有效成功笔数 × 100%；与档内各三方之间的占比不同">三方区间内占比<\/span>/);assert.match(html,/区间内占比不等同于慢单率/);
 assert.equal(rows.length,2);assert.equal(JSON.stringify(h.L.results),before);assert.doesNotMatch(html,/999999/);
});
test('provider daily comparison uses the same response and preserves daily own denominators and missing dates',async()=>{
 const h=setup(q=>Promise.resolve(durationResponse(q)));h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'toggleProvider');await flush();
 h.action(durationSegment,'providerDaily','SLOW');await flush();const html=h.instance.panel(durationSegment),rows=cellsOf(html);
 assert.equal(h.calls.length,2,'provider daily view must not add per-day or per-provider requests');
 assert.deepEqual(rows[0].slice(0,7),['2026-09-20','1000.00','33.33%','10','83.33%','50','20.00%']);
 assert.deepEqual(rows[1].slice(0,7),['2026-09-21','3000.00','27.27%','30','78.95%','350','8.57%']);
 assert.equal(rows.length,5);assert.match(rows[2][0],/2026-09-22.*当日来源未完整返回/);assert(rows[2].slice(1).every(cell=>cell==='—'));assert.match(html,/不能平均每天的比例/);
 h.action(durationSegment,'provider');assert.equal(cellsOf(h.instance.panel(durationSegment))[0][6],'10.00%');
});
test('cumulative provider labels and local searching preserve full band denominators',async()=>{
 const s={...durationSegment,cumulative:true,placement:'duration-groups'},h=setup(q=>Promise.resolve(durationResponse(q)));h.L.durationQuery='slow';
 h.instance.dimensionButton(s,'超过 5 分钟','provider');h.action(s,'toggleProvider');await flush();const html=h.instance.panel(s),rows=cellsOf(html);
 assert.equal(rows.length,1);assert.equal(rows[0][4],'80.00%');assert.equal(rows[0][6],'10.00%');assert.match(html,/>三方超时订单占比<\/span>/);assert.match(html,/严格超过指定时长/);assert(h.calls.every(q=>q.cumulative===true&&!('placement' in q)));
});
test('partial provider reads never present partial denominators as complete ratios and retry only the failure',async()=>{
 let fail=true;const h=setup(q=>q.platformId==='b'&&fail?Promise.reject(Error('provider timeout')):Promise.resolve(durationResponse(q)));h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'toggleProvider');await flush();
 let html=h.instance.panel(durationSegment);assert.match(html,/三方分档尚不完整/);assert.match(html,/比例暂不计算/);
 for(const row of cellsOf(html))assert.deepEqual([row[2],row[4],row[6]],['—','—','—']);
 fail=false;h.action(durationSegment,'retry');await flush();assert.equal(h.calls.length,3);assert.equal(h.calls[2].platformId,'b');html=h.instance.panel(durationSegment);assert.doesNotMatch(html,/三方分档尚不完整/);assert.equal(cellsOf(html)[0][6],'10.00%');
 h.L.queryFailures=[{id:'unread'}];assert(cellsOf(h.instance.panel(durationSegment)).every(row=>row[6]==='—'),'main-query failures also prevent a complete-provider rate');
});
test('old or incomplete provider payloads are errors instead of invented provider timing',async()=>{
 const h=setup(q=>{const data=durationResponse(q);delete data.groups.provider;return Promise.resolve(data)});h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'toggleProvider');await flush();
 const html=h.instance.panel(durationSegment);assert.match(html,/三方耗时分档未完整返回/);assert.equal(cellsOf(html).length,0);assert.doesNotMatch(html,/SLOW|FAST/);
});
test('provider expansion reuses provider groups already returned by platform daily comparison',async()=>{
 const h=setup(q=>Promise.resolve(durationResponse(q)));h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'platformDaily','b');await flush();assert.equal(h.calls.length,1);
 h.action(durationSegment,'toggleProvider');await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].platformId,'a');assert.equal(cellsOf(h.instance.panel(durationSegment))[0][6],'10.00%');
});
test('provider duration hides zero-hit rows but retains their denominators and confirmed daily zeros',async()=>{
 const unsafe='<img src=x onerror="alert(1)">',h=setup(q=>{const r=durationResponse(q);r.groups.provider[0].provider=unsafe;r.groups.provider[0].amount=null;r.summary[0].amount=null;const zero={provider:'ZERO',direction:'charge',currency:'INR',count:0,amount:0,valid_count:25,valid_amount:2500};r.groups.provider.push(zero);r.groups.provider_daily.push({...zero,date:'2026-09-20',valid_count:10,valid_amount:1000},{...zero,date:'2026-09-21',valid_count:15,valid_amount:1500});return Promise.resolve(r)});
 h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'toggleProvider');await flush();const html=h.instance.panel(durationSegment),rows=cellsOf(html);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|NaN|Infinity/);assert.equal(rows[0][1],'—');assert(rows.every(row=>row[2]==='—'));
 assert(!rows.some(row=>row[0]==='ZERO'));assert.equal(rows[0][6],'10.00%');
 const state=h.instance.snapshot().states.get(JSON.stringify(durationSegment));assert([...state.daily.get('all').results.values()].every(r=>r.groups.provider.some(p=>p.provider==='ZERO'&&p.valid_count===25)));
 h.action(durationSegment,'providerDaily','ZERO');await flush();const daily=cellsOf(h.instance.panel(durationSegment));assert.deepEqual(daily[0].slice(3,7),['0','0.00%','20','0.00%']);assert.deepEqual(daily[1].slice(3,7),['0','0.00%','30','0.00%']);assert.equal(h.calls.length,2);
});
test('provider requests stop scheduling when collapsed and cannot populate a changed date scope',async()=>{
 const waiting=[],h=setup(q=>new Promise(resolve=>waiting.push({q,resolve})));const third={...h.L.catalog[0],id:'c'};h.L.catalog.push(third);h.L.results.push({...h.L.results[0],platform:third});
 h.instance.button(durationSegment,'≤ 5 分钟');h.action(durationSegment,'toggleProvider');assert.equal(h.calls.length,2);assert.match(h.instance.panel(durationSegment),/三方分档读取 0 \/ 3/);
 h.action(durationSegment,'toggleProvider');waiting.forEach(p=>p.resolve(durationResponse(p.q)));await flush();assert.equal(h.calls.length,2,'the third platform must not start after collapse');
 h.L.from='2026-09-21T00:00:00';h.instance.button(durationSegment,'新日期');assert.equal(h.instance.snapshot().states.get(JSON.stringify(durationSegment)).daily.size,0);assert.equal(h.instance.panel(durationSegment),'');
});

test('latency platform success metrics and their independent shares use separate columns',()=>{
 const h=setup();h.L.to='2026-09-20T23:59:59';h.instance.dimensionButton(durationSegment,'≤ 5 分钟','platform');h.action(durationSegment,'togglePlatform');
 const html=h.instance.panel(durationSegment),rows=cellsOf(html);
 assert.match(html,/<th>成功金额<\/th><th>成功笔数<\/th><th>金额占比<\/th><th>笔数占比<\/th>/);
 assert.deepEqual(rows,[['SAME','ar','80.00','8','80.00%','80.00%'],['SAME','newar','20.00','2','20.00%','20.00%']]);
 assert.doesNotMatch(html,/analysis-metric-value|analysis-metric-share/);assert.equal(h.calls.length,0);
});
test('confirmed empty platforms do not poison a populated duration-band denominator',()=>{
 const h=setup();h.L.to='2026-09-20T23:59:59';const empty={platform:{id:'empty',name:'Empty',source:'ar'},total:0,summary:[],groups:{latency:[],latency_thresholds:[]}};h.L.results.push(empty);
 h.instance.open(durationSegment,'≤ 5 分钟');let rows=cellsOf(h.instance.panel(durationSegment));
 assert.deepEqual(rows.find(row=>row[0]==='Empty'),['Empty','ar','0.00','0','0.00%','0.00%']);assert.equal(rows.find(row=>row[1]==='newar')[4],'20.00%');
 empty.total=3;empty.summary=[{...metric(),direction:'withdraw'}];rows=cellsOf(h.instance.panel(durationSegment));assert.equal(rows.find(row=>row[1]==='newar')[5],'20.00%');
 // An incomplete or missing aggregate is not confirmation of an empty platform.
 empty.summary=[];empty.total=0;empty.complete=false;rows=cellsOf(h.instance.panel(durationSegment));assert(rows.every(row=>row[4]==='—'&&row[5]==='—'));delete empty.complete;
 empty.summary=undefined;rows=cellsOf(h.instance.panel(durationSegment));assert.equal(rows.find(row=>row[0]==='Empty')[2],'—');assert(rows.every(row=>row[4]==='—'&&row[5]==='—'));
});
test('unknown latency amounts do not suppress known count shares, and platform search preserves the band denominator',()=>{
 const h=setup(),s={...durationSegment,placement:'duration-groups'};h.L.to='2026-09-20T23:59:59';h.L.results[0].groups.latency[0].amount=null;h.L.results[0].platform.name='Filtered';h.L.durationQuery='SAME';
 h.instance.open(s,'≤ 5 分钟');const rows=cellsOf(h.instance.panel(s));assert.deepEqual(rows,[['SAME','newar','20.00','2','—','20.00%']]);assert.equal(h.calls.length,0);
});
test('latency platform daily comparisons preserve separate amount and count share columns',async()=>{
 const h=setup(q=>Promise.resolve(durationResponse(q)));h.instance.open(durationSegment,'≤ 5 分钟');h.action(durationSegment,'platformDaily','a');await flush();
 const html=h.instance.panel(durationSegment),rows=cellsOf(html);assert.match(html,/<th>成功金额<\/th><th>成功笔数<\/th><th>金额占比<\/th><th>笔数占比<\/th>/);
 assert.deepEqual(rows[0].slice(1,5),['200.00','2','20.00%','20.00%']);assert.deepEqual(rows[1].slice(1,5),['800.00','8','80.00%','80.00%']);assert(rows[2].slice(1).every(value=>value==='—'));
});

test('page snapshots restore expanded daily results without rewinding request generations or reading again',async()=>{
 const h=setup();h.instance.open(segment,'8时');h.action(segment,'daily');await flush();const html=h.instance.panel(segment),calls=h.calls.length,saved=h.instance.capture();
 h.L.serial++;h.L.queryScope='another page';h.instance.restore(null);assert.equal(h.instance.isOpen(segment),false);h.instance.open({...segment,hour:9},'other');
 h.L.serial++;h.L.queryScope='x';h.instance.restore(saved);assert.equal(h.instance.isOpen(segment),true);assert.equal(h.instance.panel(segment),html);h.action(segment,'platform');h.action(segment,'daily');await flush();assert.equal(h.calls.length,calls);
});
test('capturing an in-flight drilldown pauses its entries and late results cannot refill a restored page',async()=>{
 const waiting=[],h=setup(q=>new Promise(resolve=>waiting.push({q,resolve})));h.instance.open(segment,'8时');h.action(segment,'daily');assert.equal(h.calls.length,2);const saved=h.instance.capture();h.L.serial++;h.instance.restore(saved);
 const entry=h.instance.snapshot().states.get(JSON.stringify(segment)).daily.get('all');assert.equal(entry.loading,false);assert.match(entry.failures[0].message,/暂停/);
 for(const item of waiting)item.resolve({complete:true,hasMore:false,summary:[],groups:{daily:[{...metric(987654),date:'2026-09-20'}]}});await flush();assert.equal(entry.results.size,0);assert.doesNotMatch(h.instance.panel(segment),/987654/);
});

const customForm={kind:'latency',durationVersion:2,direction:'all',placement:'duration-custom-form'};
test('independent custom range queries only its cohort and leaves fixed distributions and totals untouched',async()=>{
 const h=setup(q=>Promise.resolve({...durationResponse(q),durationVersion:2})),before=JSON.stringify(h.L.results);
 let html=h.instance.customRange();assert.match(html,/自选区间/);assert.equal(h.calls.length,0);
 h.action(customForm,'rangeQuery');await flush();html=h.instance.customRange();
 assert.equal(h.calls.length,2);for(const q of h.calls){assert.equal(q.kind,'latency');assert.equal(q.durationVersion,2);assert.deepEqual(JSON.parse(JSON.stringify(q.durationRange)),{minSeconds:120,maxSeconds:180});assert(!('bucket'in q));assert(!('cumulative'in q));assert.equal(q.providers[0],'ORIGINAL')}
 assert.match(html,/&gt; 2 分钟，≤ 3 分钟/);assert.match(html,/>14000.00<\/td>/);assert.match(html,/>50<\/td>/);assert.match(html,/>3.57%<\/td>/);assert.equal(JSON.stringify(h.L.results),before);
 const segment=h.instance.snapshot().states.get(JSON.stringify(customForm)).rangeSegment;
 h.action(segment,'togglePlatform');assert.match(h.instance.customRange(),/>1000.00<\/td>/);assert.match(h.instance.customRange(),/>13000.00<\/td>/);assert.equal(h.calls.length,2);
 h.action(segment,'toggleProvider');await flush();assert.equal(h.calls.length,2,'provider expansion reuses the custom-range response');assert.match(h.instance.customRange(),/三方区间内占比/);
 h.action(segment,'providerDaily','SLOW');await flush();assert.equal(h.calls.length,2);assert.equal(JSON.stringify(h.L.results),before);
});
test('custom range controls validate integer seconds and stage changes until explicit query',async()=>{
 const h=setup(q=>Promise.resolve({...durationResponse(q),durationVersion:2}));h.instance.customRange();
 for(const [min,max]of [['3','2'],['-1','3'],['',''],['bad','3'],['0.0001','3']]){h.action(customForm,'rangeMin',min);h.action(customForm,'rangeMax',max);h.action(customForm,'rangeQuery');await flush();assert.equal(h.calls.length,0);assert.match(h.instance.customRange(),/请填写有效区间/)}
 h.action(customForm,'rangeMin','120');h.action(customForm,'rangeMax','180');h.action(customForm,'rangeUnit','seconds');assert.equal(h.calls.length,0);
 h.action(customForm,'rangeQuery');await flush();assert.equal(h.calls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].durationRange)),{minSeconds:120,maxSeconds:180});
 h.action(customForm,'rangeMax','240');assert.match(h.instance.customRange(),/条件已修改/);assert.match(h.instance.customRange(),/已查区间/);assert.match(h.instance.customRange(),/≤ 3 分钟/);assert.equal(h.calls.length,2);
 h.action(customForm,'rangeQuery');await flush();assert.equal(h.calls.length,4);assert.equal(h.calls[2].durationRange.maxSeconds,240);
 h.action(customForm,'rangeMin','');h.action(customForm,'rangeQuery');await flush();assert.equal(h.calls.length,6);assert.equal(h.calls[4].durationRange.minSeconds,null);
});
test('custom range failed platforms remain visible as partial, with safe ratios and retry only missing platforms',async()=>{
 let fail=true;const h=setup(q=>q.platformId==='b'&&fail?Promise.reject(Error('synthetic timeout')):Promise.resolve({...durationResponse(q),durationVersion:2}));h.instance.customRange();h.action(customForm,'rangeQuery');await flush();let html=h.instance.customRange();
 assert.match(html,/区间已读取 1 \/ 2/);assert.match(html,/比例待完整后计算/);assert.match(html,/synthetic timeout/);assert.equal(cellsOf(html)[0][3],'—');
 const segment=h.instance.snapshot().states.get(JSON.stringify(customForm)).rangeSegment;fail=false;h.action(segment,'retry');await flush();assert.equal(h.calls.length,3);assert.equal(h.calls[2].platformId,'b');html=h.instance.customRange();assert.doesNotMatch(html,/区间已读取 1 \/ 2|synthetic timeout/);assert.equal(cellsOf(html)[0][3],'3.57%');
});
test('new version drilldowns reject legacy responses instead of silently using the old five-minute band',async()=>{
 const h=setup(q=>Promise.resolve(durationResponse(q))),segment={...durationSegment,durationVersion:2};
 h.instance.button(segment,'≤60秒');h.action(segment,'toggleProvider');await flush();assert(h.calls.every(q=>q.durationVersion===2));assert.match(h.instance.panel(segment),/时效细分档未就绪/);assert.equal(cellsOf(h.instance.panel(segment)).length,0);
 const old=setup();old.instance.customRange();old.action(customForm,'rangeQuery');await flush();assert.match(old.instance.customRange(),/时效细分档未就绪/);assert(!old.instance.customRange().includes('NaN'));
});
test('new threshold indices map to three-minute/one-hour values while legacy segments keep their original indices',()=>{
 const h=setup();h.L.results.forEach(r=>{r.durationVersion=2;r.groups.latency_thresholds=[{direction:'charge',currency:'INR',threshold_ms:180000,count:7,amount:700},{direction:'charge',currency:'INR',threshold_ms:3600000,count:2,amount:200}]});
 assert.equal(h.instance.platformRows({kind:'latency',durationVersion:2,direction:'charge',bucket:1,cumulative:true})[0].success_count,7);
 assert.equal(h.instance.platformRows({kind:'latency',durationVersion:2,direction:'charge',bucket:4,cumulative:true})[0].success_count,2);
 assert.equal(h.instance.platformRows({kind:'latency',direction:'charge',bucket:2,cumulative:true})[0].success_count,2);
});

test('custom range requests are invalidated by a changed query scope without replacing fixed success data',async()=>{
 const waiting=[],h=setup(q=>new Promise(resolve=>waiting.push({q,resolve})));h.instance.customRange();h.action(customForm,'rangeQuery');assert.equal(h.calls.length,2);
 const before=JSON.stringify(h.L.results);h.L.from='2026-09-21T00:00:00';h.instance.customRange();waiting.forEach(({q,resolve})=>resolve({...durationResponse(q),durationVersion:2}));await flush();
 const html=h.instance.customRange();assert.doesNotMatch(html,/已查区间|14000.00/);assert.equal(JSON.stringify(h.L.results),before);
});
