const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-report-data.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const plain=value=>JSON.parse(JSON.stringify(value));
const feed=(x={})=>({dataset:'volume',system:'REPORT',country:'胖虎巴西',rawCountry:'胖虎巴西',name:'SYNTHETIC-PH',rawPlatform:'PH-RAW',team:'胖虎',directions:['charge','withdraw'],records:2,provenance:{kind:'google_sheets'},lastDate:'2026-09-24',...x});
const metrics=(amount,count)=>({amount,count,successAmount:null,successCount:null});
const summary=(f,x={})=>({...f,rawCountry:f.country,rawPlatform:f.platform,country:f.country,currency:null,status:'received',updatedAt:'2026-09-25T00:00:00Z',records:2,groups:[{grain:'provider',records:2,metrics:metrics(300,3),metricCoverage:{amount:2,count:2},providers:[{provider:'ONE',records:1,metrics:metrics(100,1)},{provider:'TWO',records:1,metrics:metrics(200,2)}],daily:[{date:'2026-09-24',records:2,metrics:metrics(300,3),providers:[{provider:'ONE',records:1,metrics:metrics(100,1)},{provider:'TWO',records:1,metrics:metrics(200,2)}]}]}],...x});
function fixture({catalog=[],withdrawCatalog=[],feeds=[feed()],respond,onCatalog,payoutConfig}={}){
 const calls=[],navigation=[],L={catalog,withdrawCatalog,country:'巴西',direction:'all',from:'2026-09-24T00:00:00',to:'2026-09-25T23:59:59',multi:{team:[],platform:[],source:[]}},context={HensemLivePayoutConfig:payoutConfig,setPage:page=>navigation.push(page)};let clock=Date.now();context.Date=class extends Date{static now(){return clock}};context.window=context;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-provider-aliases.js'),'utf8'),context);vm.runInNewContext(source,context);let renders=0;
 const page=context.HensemLiveReportData.create({L,E:escape,N:n=>Number(n).toFixed(2),C:n=>String(n),R:(n,d)=>(n/d*100).toFixed(2)+'%',render:()=>renders++,request:async q=>{calls.push(plain(q));return q.action==='collectedData'?(onCatalog?onCatalog(q):{rows:feeds}):respond?respond(q):{feeds:q.feeds.map(f=>summary(f))}}});return {page,L,calls,context,navigation,renders:()=>renders,advance:ms=>{clock+=ms}};
}
const scope={country:'胖虎巴西',direction:'all',from:'2026-09-24T00:00:00',to:'2026-09-25T23:59:59'};

test('catalog preserves native IDs, adds logical report-only identities and exposes teams across countries',async()=>{
 const india=feed({country:'印度',rawCountry:'IN',name:'SAME',rawPlatform:'SAME',team:'M8',system:'AR',provenance:{kind:'direct'}}),ph=feed();const f=fixture({catalog:[{id:'a',name:'SAME',country:'印度',source:'ar',team:'M8',currency:'INR'},{id:'b',name:'SAME',country:'印度',source:'newar',team:'M8',currency:'INR'}],feeds:[india,ph,{...ph,dataset:'panda_success',system:'PANDA',provenance:{kind:'direct'}}]});
 await f.page.loadCatalog();const c=f.page.catalog();assert.equal(c.length,3);assert.deepEqual(plain(c.slice(0,2).map(p=>p.id)),['a','b']);assert.equal(c[0].feeds.length,1);assert.equal(c[1].feeds.length,1);assert.equal(c[2].team,'胖虎');assert(c[2].id.startsWith('report:'));assert.equal(c[2].feeds.length,2);assert.equal(c[2].currency,'—');assert.equal(c[2].timezone,null);assert.equal(f.L.catalog.length,2);
 assert.equal(f.page.selected({teams:['胖虎']}).length,1);assert.equal(f.page.selected({country:'印度',sources:['AR']}).length,1);
});

test('authorized native source names absorb report aliases without adding platforms or changing query keys',async()=>{
 const native=[['DHANIWIN','DhaniWin','newar'],['LOTTERY77','LOTTERY7','ar'],['SHREEWIN','Shree.Win','ar'],['VEERGAME','Veer.Game','ar']].map(([name,sourceName,source],i)=>({id:'native-'+i,name,sourceName,source,country:'印度',team:'M8',currency:'INR'}));
 const seeds=['DHANI.WIN','DhaniWin','LOTTERY7','Shree.Win','Veer.Game'].map(name=>({name,country:'印度',source:'withdraw'}));
 const feeds=native.map(p=>feed({country:'印度',rawCountry:'IN',name:p.sourceName,rawPlatform:p.sourceName,system:'REPORT',team:'M8',directions:['charge']}));
 const f=fixture({catalog:native,withdrawCatalog:seeds,feeds});
 assert.deepEqual(plain(f.page.catalog().map(p=>p.id)),native.map(p=>p.id),'slow report loading must not create five alias entries');
 await f.page.load({country:'印度',direction:'charge',from:scope.from,to:scope.to});
 const catalog=f.page.catalog();assert.equal(catalog.length,4);assert(catalog.every(p=>!p.reportOnly&&p.team==='M8'));assert.deepEqual(plain(catalog.map(p=>p.source)),['newar','ar','ar','ar']);
 assert.deepEqual(plain(catalog.map(p=>p.feeds.length)),[1,1,1,1]);assert.deepEqual(plain(f.calls.find(q=>q.action==='reportSummary').feeds.map(p=>p.platform)),native.map(p=>p.sourceName));
 assert.deepEqual(plain(f.page.selected({country:'印度',sources:['newar']}).map(p=>p.id)),['native-0']);
 assert.equal(f.L.withdrawCatalog[0].name,'DHANI.WIN');assert.equal(f.page.state.catalogRows[0].rawPlatform,'DhaniWin');
});

test('directory aliases require an authorized unique target in the same original country',async()=>{
 const f=fixture({catalog:[{id:'one',name:'ONE',sourceName:'SHARED',country:'印度',team:'M8',source:'ar'},{id:'two',name:'TWO',sourceName:'SHARED',country:'印度',team:'M8',source:'newar'},{id:'veer',name:'VEERGAME',sourceName:'Veer.Game',country:'印度',team:'M8',source:'ar'}],withdrawCatalog:[{name:'SHARED',country:'印度'},{name:'Veer.Game',country:'巴西'},{name:'VEER-GAME',country:'印度'}],feeds:[]});
 const catalog=f.page.catalog();assert.equal(catalog.length,6);assert(catalog.filter(p=>p.reportOnly).every(p=>p.orderPlatformIds.length===0));
 assert.equal(catalog.find(p=>p.name==='SHARED').team,'__unassigned__');assert.equal(catalog.find(p=>p.country==='巴西').country,'巴西');assert.equal(catalog.find(p=>p.name==='VEER-GAME').reportOnly,true,'unconfirmed punctuation variants must not be guessed');
});

test('an explicitly different report backend stays selectable beside its namesake native platform',async()=>{
 for(const name of ['Shree.Win','SHREEWIN']){
  const f=fixture({catalog:[{id:'ar',name:'SHREEWIN',sourceName:'Shree.Win',country:'印度',team:'M8',source:'ar'}],feeds:[feed({name,rawPlatform:'EXACT-NEWAR-SOURCE',country:'印度',rawCountry:'IN',system:'NEW_AR',team:'M8',directions:['charge'],provenance:{kind:'direct'}})]});
  await f.page.load({country:'印度',sources:['newar'],direction:'charge',from:scope.from,to:scope.to});
  const catalog=f.page.catalog();assert.equal(catalog.length,2);assert.equal(catalog.find(p=>p.id==='ar').feeds.length,0);assert.equal(f.page.selected({country:'印度',sources:['NEW_AR']}).length,1);
  const queries=f.calls.find(q=>q.action==='reportSummary').feeds;assert.equal(queries.length,1);assert.equal(queries[0].system,'NEW_AR');assert.equal(queries[0].platform,'EXACT-NEWAR-SOURCE');
 }
});

test('shared native-source feeds are requested once with exact provenance and source direction',async()=>{
 const raw=feed({country:'印度',rawCountry:'IN',name:'SAME',rawPlatform:'SAME',team:'M8',system:'AR',directions:['charge'],provenance:{kind:'direct'}}),f=fixture({catalog:[{id:'a',name:'SAME',country:'印度',source:'ar',team:'M8'},{id:'b',name:'SAME',country:'印度',source:'newar',team:'M8'}],feeds:[raw,raw]});await f.page.load({country:'印度',platforms:['a','b'],direction:'charge',from:scope.from,to:scope.to});
 const call=f.calls.find(q=>q.action==='reportSummary');assert.equal(call.feeds.length,1);assert.deepEqual(call.feeds[0],{dataset:'volume',system:'AR',country:'IN',platform:'SAME',direction:'charge',sourceKind:'direct'});assert.equal(call.startAt,'2026-09-24');assert.equal(call.endAt,'2026-09-25');assert.match(f.page.render({page:'overview'}),/另有订单数据，独立核对/);assert.equal(f.calls.filter(q=>q.action==='aggregate').length,0);
});

test('concurrent catalog and date loads share metadata, while forced date queries refresh only figures',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=fixture({onCatalog:()=>pending});
 const a=f.page.loadCatalog(),b=f.page.loadCatalog(),c=f.page.load(scope,true);
 assert.equal(f.calls.length,1,'a date refresh must join the pending catalog request');
 resolve({rows:[feed()]});await Promise.all([a,b,c]);
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,1);
 await f.page.load(scope);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,1);
 await f.page.load(scope,true);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,2);
 const otherDates={...scope,from:'2026-09-20T00:00:00',to:'2026-09-24T23:59:59'};
 await f.page.load(otherDates,true);const queries=f.calls.filter(q=>q.action==='reportSummary');
 assert.equal(queries.length,3);assert.equal(queries[2].startAt,'2026-09-20');assert.equal(queries[2].endAt,'2026-09-24');
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,1,'new dates and explicit data refreshes reuse fresh metadata');
 await f.page.load(otherDates);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,3);
});

test('daily reports separate grains and unknown currencies, expand provider and date without database reads',async()=>{
 const f=fixture({respond:q=>({feeds:q.feeds.map(x=>summary(x,{groups:[summary(x).groups[0],{...summary(x).groups[0],grain:'platform',metrics:metrics(300,3)}]}))})});await f.page.load({...scope,direction:'charge'});let html=f.page.render({page:'overview'});assert.match(html,/原报表金额（币种未提供）/);assert.match(html,/三方明细汇总/);assert.match(html,/平台汇总/);assert.doesNotMatch(html,/BRL|手续费|<th>成功率/);assert.equal((html.match(/300\.00/g)||[]).length,2,'same report grains stay separate, never sum to 600');assert.doesNotMatch(html,/600\.00/);
 const onclick=html.match(/onclick="(liveReportToggle\([^]*?\))"/)[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');vm.runInNewContext(onclick,f.context);const before=f.calls.length;html=f.page.render({page:'overview'});assert.match(html,/ONE/);assert.match(html,/33\.33%/);assert.match(html,/colspan="10"/);const id=[...f.page.state.expanded][0];f.context.liveReportTab(id,'daily');html=f.page.render({page:'overview'});assert.match(html,/2026-09-24/);assert.match(html,/查看 2 个三方/);assert.equal(f.calls.length,before);
});

test('not received and incomplete metrics remain missing, zero remains a real zero',async()=>{
 const f=fixture({respond:q=>({feeds:q.feeds.map((x,i)=>i===0?summary(x,{status:'not_received',records:0,groups:[]}):summary(x,{groups:[{grain:'provider',records:2,metrics:{amount:null,count:0,successAmount:null,successCount:null},metricCoverage:{amount:1,count:2}}]}))})});await f.page.load(scope);const html=f.page.render({page:'overview'});assert.match(html,/所选日期未收到日报/);assert.match(html,/未完整/);assert.match(html,/<td>0<\/td>/);assert.doesNotMatch(html,/NaN|Infinity/);
});

test('provider filtering only applies to complete provider groups and uses null-preserving sums',async()=>{
 const f=fixture({respond:q=>({feeds:q.feeds.map(x=>summary(x,{groups:[summary(x).groups[0],{...summary(x).groups[0],grain:'platform'}]}))})});await f.page.load({...scope,direction:'charge',providers:['ONE']});const html=f.page.render({page:'providers'});assert.match(html,/100\.00/);assert.doesNotMatch(html,/300\.00/);assert.match(html,/此来源粒度无法按三方筛选/);assert.deepEqual(plain(f.page.providers()),['ONE','TWO']);assert.doesNotMatch(html,/成功率/);
});
test('report provider aliases merge once in totals and daily expansion with null-preserving metrics',async()=>{
 const providers=[{provider:'RushPay唤醒',records:1,metrics:metrics(100,1)},{provider:'RUSHPAY跑分',records:1,metrics:metrics(200,2)},{provider:'T3Pay唤醒',records:1,metrics:metrics(50,1)},{provider:'3TPay',records:1,metrics:metrics(null,1)}];
 const group={grain:'provider',records:4,metrics:metrics(null,5),providers,daily:[{date:'2026-09-24',records:4,metrics:metrics(null,5),providers}]};
 const f=fixture({feeds:[feed({country:'印度',rawCountry:'IN',team:'M8'})],respond:q=>({feeds:q.feeds.map(x=>summary(x,{groups:[group]}))})});
 await f.page.load({...scope,country:'印度',direction:'charge'});const sourceBefore=plain(f.page.state.result),html=f.page.render({page:'providers'});
 vm.runInNewContext(html.match(/onclick="(liveReportToggle\([^]*?\))"/)[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&'),f.context);
 let expanded=f.page.render({page:'providers'});assert.equal((expanded.match(/<td>RushPay<\/td>/g)||[]).length,1);assert.match(expanded,/>300\.00</);assert.match(expanded,/<td>T3Pay<\/td>/);assert.match(expanded,/<td>3TPay<\/td>/);
 const before=f.calls.length;f.context.liveReportTab([...f.page.state.expanded][0],'daily');expanded=f.page.render({page:'providers'});assert.match(expanded,/查看 3 个三方/);assert.equal((expanded.match(/<td>RushPay<\/td>/g)||[]).length,1);assert.equal(f.calls.length,before);assert.deepEqual(plain(f.page.state.result),sourceBefore);
 assert.deepEqual(plain(f.page.providers()),['RushPay','T3Pay','3TPay']);
 await f.page.load({...scope,country:'印度',direction:'charge',providers:['RushPay']});const selected=f.page.render({page:'providers'});assert.match(selected,/>300\.00</);assert.doesNotMatch(selected,/>350\.00</);
});

test('cancel preserves completed data for page navigation and ignores stale in-flight responses',async()=>{
 let resolve;const f=fixture({respond:q=>q.startAt==='2026-09-23'?new Promise(r=>resolve=()=>r({feeds:q.feeds.map(x=>summary(x,{rawPlatform:'STALE'}))})):Promise.resolve({feeds:q.feeds.map(x=>summary(x))})});await f.page.load(scope);const done=f.page.state.result;f.page.cancel();assert.equal(f.page.state.result,done);assert.match(f.page.render({page:'providers'}),/代收/);assert.doesNotMatch(f.page.render({page:'providers'}),/<td>代付<\/td>/);assert.doesNotMatch(f.page.render({page:'provider_payout'}),/<td>代收<\/td>/);const task=f.page.load({...scope,from:'2026-09-23'});await new Promise(setImmediate);f.page.cancel();resolve();await task;assert.equal(f.page.state.result,done);assert.equal(f.page.state.loading,false);assert.doesNotMatch(f.page.render({page:'overview'}),/STALE/);
});

test('catalog failure and missing response feeds are errors rather than empty totals',async()=>{
 const badCatalog=fixture({onCatalog:()=>{throw Error('catalog timeout')}});await badCatalog.page.load(scope);assert.match(badCatalog.page.render({page:'overview'}),/不能据此判断没有数据/);assert.equal(badCatalog.calls.filter(q=>q.action==='reportSummary').length,0);
 const missing=fixture({respond:q=>({feeds:[summary(q.feeds[0])]})});await missing.page.load(scope);assert.match(missing.page.render({page:'overview'}),/日报汇总来源返回不完整/);assert.equal(missing.page.state.result,null);
});

test('config-only platforms stay visible and link to their exact configuration target',async()=>{
 const targets=[],config=feed({dataset:'panda_config',system:'PANDA',directions:[],provenance:{kind:'direct'}}),f=fixture({feeds:[config],payoutConfig:{openTarget:q=>targets.push(q)}});await f.page.load(scope);const html=f.page.render({page:'overview'});assert.match(html,/自动出款配置接入/);assert.match(html,/查看配置/);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,0);f.context.liveReportConfig(JSON.stringify(['panda_config','PANDA','胖虎巴西','PH-RAW']));assert.deepEqual(plain(targets),[{system:'PANDA',country:'胖虎巴西',platform:'PH-RAW'}]);assert.deepEqual(f.navigation,['payout_config']);
});

test('report-only analytical pages state their actual capability and unsafe source text stays escaped',async()=>{
 const dangerous=feed({name:'<img src=x onerror=alert(1)>',rawPlatform:'unsafe" platform',system:'<svg/onload=x>'}),f=fixture({feeds:[dangerous]});await f.page.load(scope);const html=f.page.render({page:'overview'});assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<svg/);assert.match(f.page.render({page:'time'}),/日报未提供逐笔订单、小时、金额档或到账时效/);assert.equal(f.page.render({page:'rates'}),'');
});

test('explicit native source filter excludes a different direct backend but preserves generic source reports',async()=>{
 const common={country:'印度',rawCountry:'IN',name:'SAME',rawPlatform:'SAME',team:'M8',directions:['charge']},f=fixture({catalog:[{id:'ar',name:'SAME',country:'印度',source:'ar',team:'M8'},{id:'lg',name:'SAME',country:'印度',source:'lg',team:'M8'}],feeds:[feed({...common,dataset:'volume',system:'AR',provenance:{kind:'direct'}}),feed({...common,dataset:'lg_success',system:'LG',provenance:{kind:'direct'}}),feed({...common})]});await f.page.load({...scope,country:'印度',direction:'charge',sources:['ar']});const feeds=f.calls.find(q=>q.action==='reportSummary').feeds;assert.deepEqual(feeds.map(r=>r.system).sort(),['AR','REPORT']);assert(!feeds.some(r=>r.dataset==='lg_success'));
});

test('date refreshes do not extend the sixty-second catalog TTL and expired caches reload',async()=>{
 const f=fixture();await f.page.load(scope);await f.page.load(scope);assert.equal(f.calls.length,2);
 f.advance(59999);await f.page.load(scope,true);
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,2);
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,1,'metadata stays cached until its own TTL expires');
 f.advance(1);await f.page.load(scope,true);
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,2,'refreshing figures must not reset the metadata age');
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,3);
 await f.page.load(scope);assert.equal(f.calls.length,5);
 f.advance(60000);await f.page.load(scope);
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,3);
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,4,'completed report figures also expire after sixty seconds');
});

test('explicit catalog refresh discovers a new feed before TTL without changing existing platform IDs',async()=>{
 let rows=[feed({directions:['charge']})];const f=fixture({onCatalog:()=>({rows})});
 await f.page.load(scope);const id=f.page.catalog()[0].id;
 rows=[...rows,feed({dataset:'auto',directions:['withdraw']})];
 await f.page.load(scope,true);
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,1);
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').at(-1).feeds.length,1,'date refresh uses the current directory snapshot');
 await f.page.loadCatalog(true);
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,2);
 assert.equal(f.page.state.result,null,'figures using the previous feed set must be reloaded');
 assert.equal(f.page.catalog()[0].id,id);assert.equal(f.page.catalog()[0].feeds.length,2);
 await f.page.load(scope);const queries=f.calls.filter(q=>q.action==='reportSummary');assert.equal(queries.length,3);
 assert.deepEqual(queries.at(-1).feeds.map(q=>[q.dataset,q.country,q.platform,q.direction]),[
  ['volume','胖虎巴西','PH-RAW','charge'],['auto','胖虎巴西','PH-RAW','withdraw']
 ]);
});

test('non-summary report-only records produce a navigation notice instead of a blank page',async()=>{
 const f=fixture({feeds:[feed({dataset:'lg_orders',system:'LG',provenance:{kind:'direct'}})]});await f.page.load(scope);const html=f.page.render({page:'overview'});assert.match(html,/已收到其他来源记录/);assert.match(html,/查看平台数据接入/);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,0);
});

test('Panghu selectors show all 31 authorized seeds before a slow report catalog and preserve IDs when it arrives',async()=>{
 const names=['BET6867','5C555',...Array.from({length:29},(_,i)=>'AUTHORIZED-PH-'+i)],withdrawCatalog=names.map(name=>({id:'withdraw:'+name,name,country:'胖虎巴西',scopeGroup:'BR_PANGHU',team:'胖虎',source:'withdraw',currency:'BRL',timezone:'America/Sao_Paulo'}));
 let resolve;const pending=new Promise(r=>resolve=r),f=fixture({withdrawCatalog,onCatalog:()=>pending});
 const initial=f.page.catalog();assert.equal(initial.length,31);assert(initial.every(p=>p.country==='巴西'&&p.team==='胖虎'&&p.reportOnly&&p.feeds.length===0));assert(initial.every(p=>p.orderPlatformIds.length===0));assert.equal(f.page.selected({country:'巴西',teams:['胖虎']}).length,31);assert.equal(f.L.withdrawCatalog[0].country,'胖虎巴西');
 const ids=plain(initial.map(p=>p.id)),task=f.page.load({country:'巴西',teams:['胖虎'],direction:'charge',from:scope.from,to:scope.to});assert.equal(f.page.state.catalogBusy,true);assert.match(f.page.render({page:'overview'}),/正在读取源日报/);assert.equal(f.page.catalog().length,31);
 resolve({rows:names.map(name=>feed({name,rawPlatform:name}))});await task;assert.deepEqual(plain(f.page.catalog().map(p=>p.id)),ids);assert.equal(f.page.catalog().length,31);assert(f.page.catalog().every(p=>p.feeds.length===1));const request=f.calls.find(q=>q.action==='reportSummary');assert.equal(request.feeds.length,31);assert(request.feeds.every(q=>q.country==='胖虎巴西'));
});

test('a first catalog failure preserves authorized seeds and never claims their report data was loaded',async()=>{
 const f=fixture({withdrawCatalog:[{name:'BET6867',country:'胖虎巴西',team:'胖虎',scopeGroup:'BR_PANGHU'}],onCatalog:()=>{throw Error('catalog unavailable')}});await f.page.load({country:'巴西',teams:['胖虎'],...scope,country:'巴西'});assert.equal(f.page.catalog()[0].team,'胖虎');assert.equal(f.page.catalog()[0].country,'巴西');assert.equal(f.page.catalog()[0].feeds.length,0);assert.equal(f.page.state.catalogLoaded,false);assert.match(f.page.render({page:'overview'}),/日报读取未完成/);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,0);
});

test('failed explicit catalog refresh preserves identities, clears figures and retries despite the old TTL',async()=>{
 let fail=false;const f=fixture({onCatalog:()=>{if(fail)throw Error('catalog timeout');return {rows:[feed()]}}});
 await f.page.load(scope);const before=plain(f.page.catalog());assert(f.page.state.result);
 fail=true;await f.page.load(scope,true);
 assert(f.page.state.result);assert.equal(f.page.state.catalogError,'');
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,1,'a date refresh does not depend on another directory read');
 await f.page.loadCatalog(true);
 assert.deepEqual(plain(f.page.catalog()),before);assert.equal(f.page.state.result,null);
 assert.match(f.page.render({page:'overview'}),/catalog timeout/);
 await f.page.load(scope);
 assert.equal(f.page.state.result,null);assert.deepEqual(plain(f.page.catalog()),before);
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,2,'a failed explicit directory check cannot serve figures from stale metadata');
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,3,'the failed directory refresh must retry within the old TTL');
 fail=false;await f.page.load(scope);
 assert.equal(f.page.state.catalogError,'');assert.deepEqual(plain(f.page.catalog()),before);
 assert.equal(f.calls.filter(q=>q.action==='collectedData').length,4);
 assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,3);assert(f.page.state.result);
});

test('display country changes do not merge an identically named M8 Brazil platform with Panghu',async()=>{
 const m8={id:'m8:5C555',name:'5C555',country:'巴西',team:'M8',source:'ar',scopeGroup:'BR'},ph={name:'5C555',country:'胖虎巴西',team:'胖虎',scopeGroup:'BR_PANGHU'};
 const f=fixture({catalog:[m8],withdrawCatalog:[ph],feeds:[feed({name:'5C555',rawPlatform:'5C555'}),feed({country:'巴西',rawCountry:'BR',name:'5C555',rawPlatform:'5C555',team:'M8',system:'AR',provenance:{kind:'direct'}})]});await f.page.loadCatalog();assert.equal(f.page.catalog().length,2);const [native,report]=f.page.catalog();assert.equal(native.id,m8.id);assert.equal(native.team,'M8');assert.equal(report.team,'胖虎');assert.equal(native.country,report.country);assert.notEqual(native.identityCountry,report.identityCountry);assert.equal(native.feeds.length,1);assert.equal(report.feeds.length,1);
 await f.page.load({country:'巴西',teams:['胖虎'],direction:'charge',from:scope.from,to:scope.to});assert.deepEqual(f.calls.find(q=>q.action==='reportSummary').feeds.map(q=>q.country),['胖虎巴西']);assert.equal(f.page.selected({country:'巴西',teams:['M8']})[0].id,m8.id);
});

test('teams are separate from geography and a future Panghu country keeps its own country',async()=>{
 const f=fixture({catalog:[{id:'hk',name:'HK1',country:'香港',team:'香港',source:'game66',currency:'INR'},{id:'crab',name:'RC1',country:'红膏蟹',team:'红膏蟹',source:'game66',currency:'INR'},{id:'hk-india',name:'HK2',country:'香港',geographicCountry:'印度',team:'香港',source:'game66'}],withdrawCatalog:[{name:'5C555',country:'BR_PANGHU',team:'胖虎'},{name:'FUTURE-PH',country:'墨西哥',team:'胖虎',scopeGroup:'MX'}],feeds:[]});
 const c=f.page.catalog();assert(c.filter(p=>['hk','crab'].includes(p.id)).every(p=>p.country==='印度'));assert.equal(c.find(p=>p.id==='hk-india').country,'印度');assert.equal(c.find(p=>p.id==='hk').identityCountry,'香港');assert.equal(c.find(p=>p.id==='crab').team,'红膏蟹');assert(!c.some(p=>['香港','红膏蟹','胖虎巴西'].includes(p.country)));assert.deepEqual(plain(f.page.selected({teams:['胖虎']}).map(p=>p.country).sort()),['墨西哥','巴西'].sort());assert.equal(f.page.selected({country:'墨西哥',teams:['胖虎']}).length,1);
 const normalize=f.context.HensemLiveReportData.normalizeIdentity;assert.equal(normalize({country:'巴西',team:'M8',name:'5C555'}).team,'M8');assert.equal(normalize({country:'墨西哥',team:'胖虎'}).country,'墨西哥');assert.equal(normalize(normalize({country:'胖虎巴西',team:'胖虎'})).identityCountry,'胖虎巴西');
});

// Platform names are the audited 2026-09-26 registration roster; IDs and
// payloads below are synthetic. The browser may only use entries it receives.
const indiaRoster={
 M8:['51GAME','55CLUB','6CLUB','82LOTTERY','91CLUB','BIGMUMBAI','DHANIWIN','IN999','JAICLUB','JALWA','LOTTERY77','OKWIN','RAJA','RAJALOTTERY','SHREEWIN','TPPLAY','VEERGAME'],
 '香港':['365IN','777IN','8GAME','EK7','EZ777','FT7','GEM7','GG9','HU777','INDIA2026','JW777','KA9','MAX7','MM9','WR777','WW9'],
 '红膏蟹':['66GAME','PE7','W5W','XX5','XX6','XX7','YY9','YYGAME']
};
const indiaNative=()=>Object.entries(indiaRoster).flatMap(([team,names])=>names.map(name=>({id:'fixture:'+team+':'+name,name,team,country:team==='M8'?'印度':team,scopeGroup:team==='M8'?'IN':team==='香港'?'HK_TEAM':'RED_CRAB',source:team==='M8'?(name==='DHANIWIN'?'newar':'ar'):'game66',sourceName:({DHANIWIN:'DhaniWin',LOTTERY77:'LOTTERY7',SHREEWIN:'Shree.Win',VEERGAME:'Veer.Game'})[name]||name})));

test('India keeps all 41 authorized native platforms and merges game66 intake/config labels into those same IDs',async()=>{
 const catalog=indiaNative(),nativeGame66=catalog.filter(p=>p.source==='game66');
 const feeds=nativeGame66.flatMap(p=>['charge','withdraw'].map(direction=>feed({dataset:'orders',system:p.team==='香港'?'GAME66_HK':'GAME66_RED_CRAB',country:p.country,rawCountry:p.scopeGroup,name:p.name,rawPlatform:p.sourceName,team:p.team,directions:[direction],records:null,provenance:{kind:'direct'}})));
 for(const name of ['66GAME','PE7','W5W','XX6','XX7','YYGAME'])feeds.push(feed({dataset:'game66_config',system:'GAME66_RED_CRAB',country:'红膏蟹',rawCountry:'红膏蟹',name,rawPlatform:name,team:'待归类',directions:[],provenance:{kind:'direct'}}));
 const seeds=['DHANI.WIN','DhaniWin','LOTTERY7','Shree.Win','Veer.Game'].map(name=>({name,country:'印度',source:'withdraw'}));
 let resolve;const f=fixture({catalog,withdrawCatalog:seeds,onCatalog:()=>new Promise(r=>resolve=r)}),pending=f.page.loadCatalog();
 assert.equal(f.page.selected({country:'印度'}).length,41,'native identities are available while the feed directory is loading');
 resolve({rows:feeds});await pending;
 const rows=f.page.selected({country:'印度'});assert.equal(rows.length,41);assert(rows.every(p=>!p.reportOnly));
 assert.deepEqual(plain(rows.map(p=>p.id)),catalog.map(p=>p.id));
 for(const [team,names]of Object.entries(indiaRoster))assert.equal(f.page.selected({country:'印度',teams:[team]}).length,names.length);
 assert.equal(f.page.selected({country:'印度',sources:['game66']}).length,24);
 assert.equal(f.page.selected({country:'HK_TEAM'}).length,16);assert.equal(f.page.selected({country:'RED_CRAB'}).length,8);
 assert.equal(rows.find(p=>p.name==='PE7').feeds.length,3);assert.equal(rows.find(p=>p.name==='365IN').feeds.length,2);
 f.L.country='印度';f.L.multi.source=['game66'];const html=f.page.render({page:'overview'});
 assert.match(html,/自动出款配置接入/);assert.match(html,/PE7/);assert.doesNotMatch(html,/尚无可用于当前页面的日报汇总/,'native orders must not be reclassified as report-only capability gaps');
 assert.equal(f.L.catalog.find(p=>p.name==='365IN').country,'香港');assert.equal(f.page.state.catalogRows[0].rawCountry,'HK_TEAM');
});

test('geographic display labels and raw team scopes cannot merge identical platform names across India teams',async()=>{
 const catalog=[{id:'m8',name:'SAME',country:'印度',source:'ar',team:'M8'}, {id:'hk',name:'SAME',country:'香港',scopeGroup:'HK_TEAM',source:'game66',team:'香港'},{id:'crab',name:'SAME',country:'红膏蟹',scopeGroup:'RED_CRAB',source:'game66',team:'红膏蟹'}];
 const feeds=[feed({name:'SAME',rawPlatform:'HK-RAW',country:'印度',rawCountry:'HK_TEAM',team:'待归类',system:'REPORT',directions:['charge']}),feed({name:'SAME',rawPlatform:'RC-RAW',country:'印度',rawCountry:'RED_CRAB',team:'待归类',system:'REPORT',directions:['charge']}),feed({name:'SAME',rawPlatform:'M8-RAW',country:'IN',rawCountry:'IN',team:'M8',system:'AR',directions:['charge']})];
 const f=fixture({catalog,feeds});await f.page.load({country:'印度',teams:['香港'],direction:'charge'});
 assert.equal(f.page.catalog().length,3);assert(f.page.catalog().every(p=>p.feeds.length===1));
 assert.deepEqual(f.calls.find(q=>q.action==='reportSummary').feeds.map(q=>[q.country,q.platform]),[['HK_TEAM','HK-RAW']]);
 assert.deepEqual(plain(f.page.selected({country:'香港'}).map(p=>p.id)),['hk']);
 assert.deepEqual(plain(f.page.selected({country:'RED_CRAB'}).map(p=>p.id)),['crab']);
 assert.equal(f.context.HensemLiveReportData.normalizeIdentity({country:'HK_TEAM'}).country,'印度');
 assert.equal(f.context.HensemLiveReportData.normalizeIdentity({country:'印度',scope_group:'HK_TEAM'}).team,'香港');
});

test('partial authorized directories are never padded with the known roster or promoted from report-only to order platforms',async()=>{
 const all=indiaNative(),m8=all.filter(p=>p.team==='M8'),hk=all.find(p=>p.team==='香港');
 const f=fixture({catalog:m8,feeds:[feed({dataset:'orders',system:'GAME66_HK',country:'香港',rawCountry:'HK_TEAM',name:hk.name,rawPlatform:hk.name,team:'香港',provenance:{kind:'direct'}})]});
 assert.equal(f.page.selected({country:'印度'}).length,17);await f.page.loadCatalog();
 const rows=f.page.selected({country:'印度'});assert.equal(rows.length,18);assert.equal(rows.filter(p=>!p.reportOnly).length,17);
 const report=rows.find(p=>p.team==='香港');assert.equal(report.reportOnly,true);assert.deepEqual(plain(report.orderPlatformIds),[]);
 assert.equal(rows.filter(p=>p.team==='红膏蟹').length,0,'known registrations are not authority to add an absent scope');
 f.L.catalog=[...m8,hk];assert.equal(f.page.selected({country:'印度'}).length,18);assert.equal(f.page.catalog().find(p=>p.team==='香港').id,hk.id);assert.equal(f.page.catalog().find(p=>p.id===hk.id).feeds.length,1);
});

test('a conflicting game66 source-team tag remains a separate report capability',async()=>{
 const f=fixture({catalog:[{id:'hk',name:'SAME',country:'香港',team:'香港',source:'game66'}],feeds:[feed({dataset:'orders',system:'GAME66_RED_CRAB',country:'香港',rawCountry:'HK_TEAM',name:'SAME',rawPlatform:'SAME',team:'香港',provenance:{kind:'direct'}})]});
 await f.page.loadCatalog();assert.equal(f.page.catalog().length,2);assert.equal(f.page.catalog().find(p=>p.id==='hk').feeds.length,0);assert(f.page.catalog().find(p=>p.reportOnly));
});

const confirmedM8Reports=[['墨西哥','MX','南美','NPG-MEXICO'],['智利','CL','南美','NPG-CHILE'],['哥伦比亚','CO','南美','NPG-COLOMBIA'],['印尼','ID','印尼','HOT985'],['印尼','ID','印尼','IND666'],['印尼','ID','印尼','UANG'],['巴西','BR','巴西','SSSGAME'],['巴西','BR','巴西','TGJOGO']];

test('the eight owner-confirmed report platforms belong to M8 before and after the authoritative feed directory arrives',async()=>{
 const seeds=confirmedM8Reports.map(([country,scopeGroup,rawCountry,name])=>({country,scopeGroup,name,source:'withdraw',team:null}));
 let resolve;const f=fixture({withdrawCatalog:seeds,onCatalog:()=>new Promise(r=>resolve=r)}),before=plain(f.page.catalog());
 assert.equal(before.length,8);assert(before.every(p=>p.team==='M8'&&p.reportOnly&&!p.orderPlatformIds.length));
 for(const [country,,,name]of confirmedM8Reports)assert.equal(f.page.selected({country,teams:['M8']}).find(p=>p.name===name).team,'M8');
 const pending=f.page.loadCatalog();assert.equal(f.page.catalog().length,8);
 resolve({rows:confirmedM8Reports.map(([country,,rawCountry,name])=>feed({dataset:'auto',system:'REPORT',country,rawCountry,name,rawPlatform:name,team:'M8',directions:['withdraw']}))});await pending;
 const after=f.page.catalog();assert.deepEqual(plain(after.map(p=>p.id)),before.map(p=>p.id));assert(after.every(p=>p.team==='M8'&&p.feeds.length===1&&p.reportOnly));
 for(const [country,,rawCountry,name]of confirmedM8Reports){await f.page.load({country,teams:['M8'],platforms:[after.find(p=>p.name===name).id],direction:'withdraw'});assert.deepEqual(f.calls.filter(q=>q.action==='reportSummary').at(-1).feeds.map(q=>[q.country,q.platform]),[[rawCountry,name]]);}
 assert.equal(f.L.withdrawCatalog[0].country,'墨西哥');assert.equal(f.page.state.catalogRows[0].rawCountry,'南美');
});

test('confirmed M8 assignments preserve explicit ownership, other countries, Panghu and historical LG source identities',()=>{
 const f=fixture({feeds:[]}),normalize=f.context.HensemLiveReportData.normalizeIdentity;
 for(const [country,code,,name]of confirmedM8Reports){
  for(const team of [null,'待归类','__unassigned__','未绑定团队'])assert.equal(normalize({country:code,name,team}).team,'M8');
  assert.equal(normalize({country,name,team:'OTHER-EXPLICIT'}).team,'OTHER-EXPLICIT');
  assert.equal(normalize({country:'印度',name,team:null}).team,'__unassigned__');
  assert.equal(normalize({country,name:name+'-OTHER',team:null}).team,'__unassigned__');
 }
 const ph=normalize({country:'胖虎巴西',scopeGroup:'BR_PANGHU',name:'SSSGAME',team:null});assert.equal(ph.team,'胖虎');assert.equal(ph.identityCountry,'胖虎巴西');
 const legacy=normalize({country:'LG',name:'SUPERLG',team:null});assert.equal(legacy.team,'__unassigned__');assert.equal(legacy.identityCountry,'LG');
 assert.equal(f.page.catalog().length,0,'the confirmation only labels received identities and does not add platforms');
});

test('intake uses the same team/country display but keeps exact source keys for detail and config reads',async()=>{
 const f=fixture({catalog:[{id:'m8',name:'SAME',country:'巴西',team:'M8',source:'ar'}],withdrawCatalog:[{name:'SAME',country:'胖虎巴西',team:'胖虎'}]});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-collected-data.js'),'utf8'),f.context);
 const calls=[],page=f.context.HensemLiveCollectedData.create({L:f.L,E:escape,C:String,N:String,render:()=>{},table:(heads,rows)=>'<table><thead>'+heads.map(x=>'<th>'+x+'</th>').join('')+'</thead>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</table>',box:(title,body)=>'<h2>'+title+'</h2>'+body,request:async q=>{calls.push(plain(q));return q.operation==='catalog'?{rows:[feed({name:'SAME',rawPlatform:'SAME'})]}:{total:0,rows:[]}}});
 await page.load();let html=page.render();assert.match(html,/2 个平台/);assert.doesNotMatch(html,/<option value="胖虎巴西"/);assert.match(html,/<td>胖虎<\/td><td>巴西<\/td><td>SAME<\/td>/);f.context.collectedSet('team','胖虎');html=page.render();assert.match(html,/当前 1 个/);f.context.collectedOpen(0,1,'charge');await new Promise(setImmediate);assert.equal(calls.at(-1).country,'胖虎巴西');assert.equal(calls.at(-1).platform,'SAME');assert.equal(calls.at(-1).direction,'charge');
});

test('tab snapshot restores source report scope, expanded rows and tab choices without a new read',async()=>{
 const f=fixture();await f.page.load(scope);const result=f.page.state.result;f.page.state.expanded.add('saved');f.page.state.tabs.set('saved','daily');const saved=f.page.capture();
 await f.page.load({...scope,direction:'withdraw'},true);f.advance(120000);const reads=f.calls.length,serial=f.page.state.serial;f.page.restore(saved);
 assert.equal(f.page.state.result,result);assert.equal(f.page.state.scope.direction,'all');assert(f.page.state.expanded.has('saved'));assert.equal(f.page.state.tabs.get('saved'),'daily');assert(f.page.state.serial>serial);f.page.render();assert.equal(f.calls.length,reads);
});
test('restoring a paused source report cannot accept its old response or reuse an unrelated completed scope',async()=>{
 let resolve,pause=false;const f=fixture({respond:q=>pause?new Promise(r=>resolve=()=>r({feeds:q.feeds.map(summary)})):{feeds:q.feeds.map(summary)}});await f.page.load(scope);pause=true;const pending=f.page.load({...scope,direction:'withdraw'},true);await new Promise(setImmediate);const saved=f.page.capture();f.page.restore(saved);assert.match(f.page.state.error,/暂停/);assert.equal(f.page.state.loading,false);resolve();await pending;assert.equal(f.page.state.result,null);f.page.cancel();assert.equal(f.page.state.result,null);
});
