const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-report-data.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const plain=value=>JSON.parse(JSON.stringify(value));
const feed=(x={})=>({dataset:'volume',system:'REPORT',country:'胖虎巴西',rawCountry:'胖虎巴西',name:'SYNTHETIC-PH',rawPlatform:'PH-RAW',team:'胖虎',directions:['charge','withdraw'],records:2,provenance:{kind:'google_sheets'},lastDate:'2026-09-24',...x});
const metrics=(amount,count)=>({amount,count,successAmount:null,successCount:null});
const summary=(f,x={})=>({...f,rawCountry:f.country,rawPlatform:f.platform,country:f.country,currency:null,status:'received',updatedAt:'2026-09-25T00:00:00Z',records:2,groups:[{grain:'provider',records:2,metrics:metrics(300,3),metricCoverage:{amount:2,count:2},providers:[{provider:'ONE',records:1,metrics:metrics(100,1)},{provider:'TWO',records:1,metrics:metrics(200,2)}],daily:[{date:'2026-09-24',records:2,metrics:metrics(300,3),providers:[{provider:'ONE',records:1,metrics:metrics(100,1)},{provider:'TWO',records:1,metrics:metrics(200,2)}]}]}],...x});
function fixture({catalog=[],withdrawCatalog=[],feeds=[feed()],respond,onCatalog,payoutConfig}={}){
 const calls=[],navigation=[],L={catalog,withdrawCatalog,country:'巴西',direction:'all',from:'2026-09-24T00:00:00',to:'2026-09-25T23:59:59',multi:{team:[],platform:[],source:[]}},context={HensemLivePayoutConfig:payoutConfig,setPage:page=>navigation.push(page)};let clock=Date.now();context.Date=class extends Date{static now(){return clock}};context.window=context;vm.runInNewContext(source,context);let renders=0;
 const page=context.HensemLiveReportData.create({L,E:escape,N:n=>Number(n).toFixed(2),C:n=>String(n),R:(n,d)=>(n/d*100).toFixed(2)+'%',render:()=>renders++,request:async q=>{calls.push(plain(q));return q.action==='collectedData'?(onCatalog?onCatalog(q):{rows:feeds}):respond?respond(q):{feeds:q.feeds.map(f=>summary(f))}}});return {page,L,calls,context,navigation,renders:()=>renders,advance:ms=>{clock+=ms}};
}
const scope={country:'胖虎巴西',direction:'all',from:'2026-09-24T00:00:00',to:'2026-09-25T23:59:59'};

test('catalog preserves native IDs, adds logical report-only identities and exposes teams across countries',async()=>{
 const india=feed({country:'印度',rawCountry:'IN',name:'SAME',rawPlatform:'SAME',team:'M8',system:'AR',provenance:{kind:'direct'}}),ph=feed();const f=fixture({catalog:[{id:'a',name:'SAME',country:'印度',source:'ar',team:'M8',currency:'INR'},{id:'b',name:'SAME',country:'印度',source:'newar',team:'M8',currency:'INR'}],feeds:[india,ph,{...ph,dataset:'panda_success',system:'PANDA',provenance:{kind:'direct'}}]});
 await f.page.loadCatalog();const c=f.page.catalog();assert.equal(c.length,3);assert.deepEqual(plain(c.slice(0,2).map(p=>p.id)),['a','b']);assert.equal(c[0].feeds.length,1);assert.equal(c[1].feeds.length,1);assert.equal(c[2].team,'胖虎');assert(c[2].id.startsWith('report:'));assert.equal(c[2].feeds.length,2);assert.equal(c[2].currency,'—');assert.equal(c[2].timezone,null);assert.equal(f.L.catalog.length,2);
 assert.equal(f.page.selected({teams:['胖虎']}).length,1);assert.equal(f.page.selected({country:'印度',sources:['AR']}).length,1);
});

test('shared native-source feeds are requested once with exact provenance and source direction',async()=>{
 const raw=feed({country:'印度',rawCountry:'IN',name:'SAME',rawPlatform:'SAME',team:'M8',system:'AR',directions:['charge'],provenance:{kind:'direct'}}),f=fixture({catalog:[{id:'a',name:'SAME',country:'印度',source:'ar',team:'M8'},{id:'b',name:'SAME',country:'印度',source:'newar',team:'M8'}],feeds:[raw,raw]});await f.page.load({country:'印度',platforms:['a','b'],direction:'charge',from:scope.from,to:scope.to});
 const call=f.calls.find(q=>q.action==='reportSummary');assert.equal(call.feeds.length,1);assert.deepEqual(call.feeds[0],{dataset:'volume',system:'AR',country:'IN',platform:'SAME',direction:'charge',sourceKind:'direct'});assert.equal(call.startAt,'2026-09-24');assert.equal(call.endAt,'2026-09-25');assert.match(f.page.render({page:'overview'}),/另有订单数据，独立核对/);assert.equal(f.calls.filter(q=>q.action==='aggregate').length,0);
});

test('concurrent catalog and load reuse metadata, query scopes cache and user force reloads',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=fixture({onCatalog:()=>pending});const a=f.page.loadCatalog(),b=f.page.loadCatalog(),c=f.page.load(scope);assert.equal(f.calls.length,1);resolve({rows:[feed()]});await Promise.all([a,b,c]);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,1);await f.page.load(scope);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,1);await f.page.load(scope,true);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,2);assert.equal(f.calls.filter(q=>q.action==='collectedData').length,2);
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

test('completed report and catalog caches expire after sixty seconds and force discovers a new feed',async()=>{
 const f=fixture();await f.page.load(scope);let count=f.calls.length;await f.page.load(scope);assert.equal(f.calls.length,count);f.advance(60001);await f.page.load(scope);assert.equal(f.calls.filter(q=>q.action==='collectedData').length,2);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,2);await f.page.load(scope,true);assert.equal(f.calls.filter(q=>q.action==='collectedData').length,3);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,3);
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

test('failed forced catalog refresh preserves session identities but clears report figures and remains retryable',async()=>{
 let fail=false;const f=fixture({onCatalog:()=>{if(fail)throw Error('catalog timeout');return {rows:[feed()]}}});await f.page.load(scope);const before=plain(f.page.catalog());assert(f.page.state.result);fail=true;await f.page.load(scope,true);assert.deepEqual(plain(f.page.catalog()),before);assert.equal(f.page.state.result,null);assert.match(f.page.render({page:'overview'}),/catalog timeout/);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,1,'stale metadata cannot be used after a failed freshness check');
 fail=false;await f.page.load(scope);assert.equal(f.page.state.catalogError,'');assert.equal(f.calls.filter(q=>q.action==='collectedData').length,3,'retry must not be swallowed by the old metadata TTL');assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,2);
});

test('display country changes do not merge an identically named M8 Brazil platform with Panghu',async()=>{
 const m8={id:'m8:5C555',name:'5C555',country:'巴西',team:'M8',source:'ar',scopeGroup:'BR'},ph={name:'5C555',country:'胖虎巴西',team:'胖虎',scopeGroup:'BR_PANGHU'};
 const f=fixture({catalog:[m8],withdrawCatalog:[ph],feeds:[feed({name:'5C555',rawPlatform:'5C555'}),feed({country:'巴西',rawCountry:'BR',name:'5C555',rawPlatform:'5C555',team:'M8',system:'AR',provenance:{kind:'direct'}})]});await f.page.loadCatalog();assert.equal(f.page.catalog().length,2);const [native,report]=f.page.catalog();assert.equal(native.id,m8.id);assert.equal(native.team,'M8');assert.equal(report.team,'胖虎');assert.equal(native.country,report.country);assert.notEqual(native.identityCountry,report.identityCountry);assert.equal(native.feeds.length,1);assert.equal(report.feeds.length,1);
 await f.page.load({country:'巴西',teams:['胖虎'],direction:'charge',from:scope.from,to:scope.to});assert.deepEqual(f.calls.find(q=>q.action==='reportSummary').feeds.map(q=>q.country),['胖虎巴西']);assert.equal(f.page.selected({country:'巴西',teams:['M8']})[0].id,m8.id);
});

test('teams are separate from geography and a future Panghu country keeps its own country',async()=>{
 const f=fixture({catalog:[{id:'hk',name:'HK1',country:'香港',team:'香港',source:'game66',currency:'INR'},{id:'crab',name:'RC1',country:'红膏蟹',team:'红膏蟹',source:'game66',currency:'INR'},{id:'hk-india',name:'HK2',country:'香港',geographicCountry:'印度',team:'香港',source:'game66'}],withdrawCatalog:[{name:'5C555',country:'BR_PANGHU',team:'胖虎'},{name:'FUTURE-PH',country:'墨西哥',team:'胖虎',scopeGroup:'MX'}],feeds:[]});
 const c=f.page.catalog();assert(c.filter(p=>['hk','crab'].includes(p.id)).every(p=>p.country==='国家待核对'));assert.equal(c.find(p=>p.id==='hk-india').country,'印度');assert(!c.some(p=>['香港','红膏蟹','胖虎巴西'].includes(p.country)));assert.deepEqual(plain(f.page.selected({teams:['胖虎']}).map(p=>p.country).sort()),['墨西哥','巴西'].sort());assert.equal(f.page.selected({country:'墨西哥',teams:['胖虎']}).length,1);
 const normalize=f.context.HensemLiveReportData.normalizeIdentity;assert.equal(normalize({country:'巴西',team:'M8',name:'5C555'}).team,'M8');assert.equal(normalize({country:'墨西哥',team:'胖虎'}).country,'墨西哥');assert.equal(normalize(normalize({country:'胖虎巴西',team:'胖虎'})).identityCountry,'胖虎巴西');
});

test('intake uses the same team/country display but keeps exact source keys for detail and config reads',async()=>{
 const f=fixture({catalog:[{id:'m8',name:'SAME',country:'巴西',team:'M8',source:'ar'}],withdrawCatalog:[{name:'SAME',country:'胖虎巴西',team:'胖虎'}]});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-collected-data.js'),'utf8'),f.context);
 const calls=[],page=f.context.HensemLiveCollectedData.create({L:f.L,E:escape,C:String,N:String,render:()=>{},table:(heads,rows)=>'<table><thead>'+heads.map(x=>'<th>'+x+'</th>').join('')+'</thead>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</table>',box:(title,body)=>'<h2>'+title+'</h2>'+body,request:async q=>{calls.push(plain(q));return q.operation==='catalog'?{rows:[feed({name:'SAME',rawPlatform:'SAME'})]}:{total:0,rows:[]}}});
 await page.load();let html=page.render();assert.match(html,/2 个平台/);assert.doesNotMatch(html,/<option value="胖虎巴西"/);assert.match(html,/<td>胖虎<\/td><td>巴西<\/td><td>SAME<\/td>/);f.context.collectedSet('team','胖虎');html=page.render();assert.match(html,/当前 1 个/);f.context.collectedOpen(0,1,'charge');await new Promise(setImmediate);assert.equal(calls.at(-1).country,'胖虎巴西');assert.equal(calls.at(-1).platform,'SAME');assert.equal(calls.at(-1).direction,'charge');
});
