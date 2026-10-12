/* Synthetic responses only. Historical success cache must not become evidence of missing data. */
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-pending-snapshot.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const initialNow=Date.parse('2026-10-12T12:00:00Z');
const platform=(id=A)=>({id,name:'Synthetic A',sourceName:'Synthetic A',rawPlatform:'Native A',country:'印度',team:'Synthetic Team',source:'AR',timezone:'Asia/Kolkata',currency:'INR'});
const row=(id=A)=>({...platform(id),selectedIds:[id],state:'complete',wholeStockComplete:true,count:2,amount:'123.45',knownCount:2,knownAmount:'123.45',settlementAmounts:[],groups:[]});
const response=q=>({version:2,mode:'midnight',basis:'local_midnight_pending_snapshot',date:q.date,sourceDate:new Date(Date.parse(q.date+'T00:00:00Z')-86400000).toISOString().slice(0,10),queriedAt:new Date(initialNow).toISOString(),currency:'INR',complete:true,expectedPlatformCount:q.platformIds.length,receivedPlatformCount:q.platformIds.length,missingPlatforms:[],count:q.platformIds.length*2,amount:String(q.platformIds.length*123.45),knownCount:q.platformIds.length*2,knownAmount:String(q.platformIds.length*123.45),rows:q.platformIds.map(row)});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
 const L={country:'印度',currency:'INR',from:'2026-10-08T00:00:00',to:'2026-10-08T23:59:59',direction:'all',status:'all',queryNow:initialNow,dirty:false,withdrawCatalog:[],multi:{team:[],source:[],platform:[],provider:[]}},calls=[];
 let selected=[platform()],providers=[],authorization={identity:'Synthetic user',assignmentVersion:1,permissions:['overview.query']},now=initialNow,catalogReady=true,allowed=true,prepareCalls=0,handler=response,orders=null;
 const config={L,E:String,N:String,C:String,selected:()=>selected,providers:()=>providers,scopeZone:()=>selected[0]?.timezone||'Asia/Kolkata',accessContext:()=>authorization,cacheNow:()=>now,catalogComplete:()=>catalogReady,canLoad:()=>allowed,prepare:async()=>{prepareCalls++;await options.prepare?.()},request:q=>{calls.push(q);return handler(q)},currentOrders:()=>orders,render(){},open(){}};
 if(options.noAccess)delete config.accessContext;
 const ui=create(config);
 return {ui,L,calls,config,handler:value=>handler=value,select:value=>selected=value,providers:value=>providers=value,auth:value=>authorization=value,now:value=>now=value,catalog:value=>catalogReady=value,allow:value=>allowed=value,orders:value=>orders=value,get selected(){return selected},get prepareCalls(){return prepareCalls}};
}

test('historical complete responses reuse five-minute memory entries and isolate returned mutation',async()=>{
 const h=harness();let raw;h.handler(q=>(raw=response(q)));await h.ui.load();assert.equal(h.ui.state.cacheHit,false);h.ui.state.data.amount='999';raw.rows[0].amount='999';
 await h.ui.load();assert.equal(h.calls.length,1);assert.equal(h.ui.state.data.amount,'123.45');assert.equal(h.ui.state.data.rows[0].amount,'123.45');assert.equal(h.ui.state.cacheHit,true);assert.equal(h.ui.state.cachedAt,initialNow);assert.match(h.ui.metric(),/缓存/);
 h.ui.state.data.rows[0].count=999;await h.ui.load();assert.equal(h.calls.length,1);assert.equal(h.ui.state.data.rows[0].count,2);
});

test('TTL is absolute, cache hits do not extend it, and backward clock changes invalidate entries',async()=>{
 const h=harness();await h.ui.load();h.now(initialNow+299999);await h.ui.load();assert.equal(h.calls.length,1);h.now(initialNow+300000);await h.ui.load();assert.equal(h.calls.length,2);h.now(initialNow-1);await h.ui.load();assert.equal(h.calls.length,3);
});

test('render and saved-tab restore disclose original cache read time and expiry without querying',async()=>{
 const h=harness();await h.ui.load();await h.ui.load();const saved=h.ui.capture();assert.match(h.ui.metric(),/缓存读取于 2026-10-12 17:30:00/);assert.doesNotMatch(h.ui.metric(),/缓存已过期|5分钟内缓存/);
 h.now(initialNow+299999);assert.doesNotMatch(h.ui.metric(),/缓存已过期/);h.now(initialNow+300000);assert.match(h.ui.metric(),/缓存已过期，查询更新/);assert.match(h.ui.summary(),/缓存读取于 2026-10-12 17:30:00/);assert.equal(h.calls.length,1);
 h.now(initialNow+600000);h.ui.restore(null);h.ui.restore(saved);assert.match(h.ui.metric(),/缓存读取于 2026-10-12 17:30:00/);assert.match(h.ui.metric(),/缓存已过期，查询更新/);assert.equal(h.calls.length,1);
 h.now(initialNow-1);assert.match(h.ui.metric(),/缓存已过期，查询更新/);assert.equal(h.calls.length,1);
});

test('each document instance has independent memory and an explicit authorization context is required',async()=>{
 const a=harness(),b=harness();await a.ui.load();await b.ui.load();assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);
 for(const h of [harness({noAccess:true}),harness()]){h.auth('');await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);assert.equal(h.ui.state.cacheHit,false);}
 const h=harness();h.config.accessContext=()=>{throw Error('Synthetic access unavailable')};await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);
 for(const context of [{},[],true,1,' ']){const h=harness();h.auth(context);await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);}
});

test('identity, assignment and permission changes clear cache and suppress captured old-scope values',async()=>{
 const h=harness();await h.ui.load();const saved=h.ui.capture();h.auth({identity:'Other user',assignmentVersion:1,permissions:['overview.query']});assert.equal(h.ui.state.data,null);h.ui.restore(saved);assert.equal(h.ui.state.data,null);await h.ui.load();assert.equal(h.calls.length,2);
 h.auth({identity:'Synthetic user',assignmentVersion:1,permissions:['overview.query']});await h.ui.load();assert.equal(h.calls.length,3,'returning to old credentials cannot resurrect old cache');
 h.auth({identity:'Synthetic user',assignmentVersion:2,permissions:['overview.query']});await h.ui.load();assert.equal(h.calls.length,4);h.auth('');assert.equal(h.ui.state.data,null);await h.ui.load();await h.ui.load();assert.equal(h.calls.length,6);
});

test('authorization object property order is stable without removing permission or assignment fields',async()=>{
 const h=harness();h.auth({identity:'A',permissions:['read'],version:1});await h.ui.load();h.auth({version:1,permissions:['read'],identity:'A'});await h.ui.load();assert.equal(h.calls.length,1);h.auth({version:1,permissions:['read','extra'],identity:'A'});await h.ui.load();assert.equal(h.calls.length,2);
});

test('exact filters, provider scope and native platform identity isolate cache keys',async()=>{
 const changes=[
  h=>h.L.from='2026-10-07T00:00:00',h=>h.L.to='2026-10-08T20:00:00',h=>h.L.country='India',h=>h.L.currency='USD',h=>h.L.team='Other team',h=>h.L.source='newar',h=>h.L.platform=B,h=>h.L.provider='Other',h=>h.L.direction='withdraw',h=>h.L.status='pending',h=>h.L.multi.team=['Scoped'],h=>h.L.orderNumber='SYNTHETIC',h=>h.L.thirdPartyOrderNumber='SYNTHETIC',h=>h.L.memberId='SYNTHETIC',h=>h.L.systemOrderId='SYNTHETIC',h=>h.L.utr='SYNTHETIC',h=>h.providers(['Pay B']),h=>h.select([platform(B)]),h=>h.select([{...platform(),rawPlatform:'Native B'}]),h=>h.select([{...platform(),source:'newar'}]),h=>h.select([{...platform(),feeds:[{rawPlatform:'Native feed B'}]}]),h=>h.select([{...platform(),team:'Other team'}]),h=>h.select([{...platform(),timezone:'Asia/Karachi'}])
 ];
 for(const change of changes){const h=harness();await h.ui.load();change(h);await h.ui.load();assert.equal(h.calls.length,2,String(change));}
 const h=harness();h.providers(['B','A','A']);await h.ui.load();h.providers(['A','B']);await h.ui.load();assert.equal(h.calls.length,1);h.L.queryNow+=1000;await h.ui.load();assert.equal(h.calls.length,1,'a later query clock does not change this fixed historical scope');
});

test('partial, missing, invalid and error responses never enter the success cache',async()=>{
 const changes=[
  r=>({...r,complete:false,count:null,amount:null,rows:[{...r.rows[0],state:'partial',wholeStockComplete:false,count:null,amount:null}]}),
  r=>({...r,complete:false,count:null,amount:null,knownCount:null,knownAmount:null,receivedPlatformCount:0,rows:[{...r.rows[0],state:'missing',wholeStockComplete:false,count:null,amount:null,knownCount:null,knownAmount:null}]}),
  r=>({...r,version:1}),r=>({...r,missingPlatforms:[A]}),r=>({...r,rows:[{...r.rows[0],groupsLimited:true}]}),
  r=>({...r,rows:[{...r.rows[0],settlementAmounts:[{currency:'USDT',amount:'5',count:1,missingCount:1,state:'partial'}]}]}),
  r=>({...r,rows:[{...r.rows[0],groups:[{count:null,amount:null,knownCount:1,knownAmount:'5',settlementAmounts:[]}]}]})
 ];
 for(const change of changes){const h=harness();h.handler(q=>change(response(q)));await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);assert.notEqual(h.ui.state.cacheHit,true);}
 const h=harness();h.handler(()=>{throw Error('Synthetic timeout')});await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);assert.equal(h.ui.state.status,'error');
});

test('verified complete zero can be cached but unknown directory and unsupported platforms cannot',async()=>{
 const h=harness();h.handler(q=>({...response(q),count:0,amount:'0',knownCount:0,knownAmount:'0',rows:[{...row(),count:0,amount:'0',knownCount:0,knownAmount:'0'}]}));await h.ui.load();await h.ui.load();assert.equal(h.calls.length,1);assert.equal(h.ui.state.data.count,0);
 for(const change of [h=>h.catalog(false),h=>h.select([platform(),{...platform('report:unbound'),name:'Other',reportOnly:true}])]){const h=harness();change(h);await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);}
});

test('cached entries still require prepared authorized directories and the ordinary primary-work gate',async()=>{
 const h=harness();await h.ui.load();h.allow(false);const prepared=h.prepareCalls;await h.ui.load();assert.equal(h.prepareCalls,prepared);h.allow(true);h.catalog(false);await h.ui.load();assert.equal(h.calls.length,2);h.catalog(true);h.L.dirty=true;await h.ui.load();assert.equal(h.calls.length,2);
 const wait=deferred(),late=harness({prepare:()=>wait.promise});late.select([{...platform('report:late'),reportOnly:true}]);const loading=late.ui.load();late.L.withdrawCatalog=[platform(B)];wait.resolve();await loading;assert.deepEqual(late.calls[0].platformIds,[B]);await late.ui.load();assert.equal(late.calls.length,1);
});

test('load(true) bypasses a hit, discards the prior entry and replaces it only after success',async()=>{
 const h=harness();await h.ui.load();h.handler(()=>{throw Error('Synthetic refresh failed')});await h.ui.load(true);assert.equal(h.calls.length,2);assert.equal(h.ui.state.status,'error');h.handler(response);await h.ui.load();assert.equal(h.calls.length,3);await h.ui.load();assert.equal(h.calls.length,3);assert.equal(h.ui.state.cacheHit,true);
});

test('force refresh supersedes an active read without transport overlap or late cache repopulation',async()=>{
 const h=harness(),old=deferred(),fresh=deferred();let active=0,maximum=0;h.handler(async()=>{maximum=Math.max(maximum,++active);try{return await (h.calls.length===1?old.promise:fresh.promise)}finally{active--}});
 const first=h.ui.load();await settle();const second=h.ui.load(true);assert.strictEqual(first,second);await settle();assert.equal(h.calls.length,1);old.resolve(response(h.calls[0]));await settle();assert.equal(h.calls.length,2);assert.equal(h.ui.state.status,'loading');fresh.resolve(response(h.calls[1]));await Promise.all([first,second]);assert.equal(maximum,1);await h.ui.load();assert.equal(h.calls.length,2);
});

test('cancelled late responses cannot populate cache or bypass the single-flight lock',async()=>{
 const h=harness(),late=deferred();h.handler(()=>late.promise);const old=h.ui.load();await settle();h.ui.cancel();h.handler(response);const fresh=h.ui.load();await settle();assert.equal(h.calls.length,1);late.resolve(response(h.calls[0]));await Promise.all([old,fresh]);assert.equal(h.calls.length,2);await h.ui.load();assert.equal(h.calls.length,2);
});

test('authority change during a request prevents old publication and old-context cache reuse',async()=>{
 const h=harness(),late=deferred();h.handler(()=>late.promise);const old=h.ui.load();await settle();h.auth({identity:'B'});late.resolve(response(h.calls[0]));await old;assert.equal(h.ui.state.data,null);h.auth({identity:'Synthetic user',assignmentVersion:1,permissions:['overview.query']});h.handler(response);await h.ui.load();assert.equal(h.calls.length,2);
});

test('server authorization denial clears all scopes before a prior successful scope can be reused',async()=>{
 for(const code of ['401','403','permission_denied','session_expired']){
  const h=harness();h.providers(['Pay A']);await h.ui.load();h.providers(['Pay B']);h.handler(()=>{throw Object.assign(Error('Synthetic access rejected'),{code})});await h.ui.load();assert.equal(h.ui.state.status,'error');h.providers(['Pay A']);await h.ui.load();assert.equal(h.calls.length,3,code);assert.equal(h.ui.state.status,'error');assert.doesNotMatch(h.ui.metric(),/>0(?:.00)?<|123.45/);
 }
});

test('late cancelled authorization denial still clears cache, but ordinary timeout preserves other scopes',async()=>{
 const h=harness(),denied=deferred();h.providers(['Pay A']);await h.ui.load();h.providers(['Pay B']);h.handler(()=>denied.promise);const old=h.ui.load();await settle();h.ui.cancel();h.providers(['Pay A']);h.handler(()=>{throw Object.assign(Error('Synthetic permission denied'),{code:'403'})});const fresh=h.ui.load();denied.reject(Object.assign(Error('Synthetic permission denied'),{code:'403'}));await Promise.all([old,fresh]);assert.equal(h.calls.length,3);assert.equal(h.ui.state.status,'error');
 const ordinary=harness();ordinary.providers(['Pay A']);await ordinary.ui.load();ordinary.providers(['Pay B']);ordinary.handler(()=>{throw Error('Synthetic timeout')});await ordinary.ui.load();ordinary.providers(['Pay A']);await ordinary.ui.load();assert.equal(ordinary.calls.length,2);assert.equal(ordinary.ui.state.cacheHit,true);
});

test('today always reads through current aggregate results and never makes a snapshot cache request',async()=>{
 const h=harness();await h.ui.load();h.L.from='2026-10-12T00:00:00';h.L.to='2026-10-12T23:59:59';const context={scopeMatches:true,status:'all',platforms:[platform()],results:[{platform:platform(),summary:[{direction:'withdraw',currency:'INR',pending_count:1,pending_amount:'10'}],groups:{provider:[]}}],failures:[],queriedAt:new Date(initialNow).toISOString()};h.orders(context);await h.ui.load();assert.equal(h.ui.state.data.amount,10);context.results[0].summary[0].pending_amount='20';await h.ui.load(true);assert.equal(h.ui.state.data.amount,20);assert.equal(h.calls.length,1);
});

test('LRU has at most 32 entries and never promotes a hit into a permanent entry',async()=>{
 const h=harness();for(let i=0;i<32;i++){h.providers(['Pay '+i]);await h.ui.load();}h.providers(['Pay 0']);await h.ui.load();assert.equal(h.calls.length,32);h.providers(['Pay 32']);await h.ui.load();h.providers(['Pay 0']);await h.ui.load();assert.equal(h.calls.length,33);h.providers(['Pay 1']);await h.ui.load();assert.equal(h.calls.length,34);
});

test('single-entry cap is one MiB in UTF-8 and total retained serialized data is below four MiB',async()=>{
 for(const padding of ['x'.repeat(1024*1024),'中'.repeat(360000)]){const h=harness();h.handler(q=>({...response(q),syntheticPadding:padding}));await h.ui.load();await h.ui.load();assert.equal(h.calls.length,2);}
 const h=harness();h.handler(q=>({...response(q),syntheticPadding:'x'.repeat(700000)}));for(let i=0;i<6;i++){h.providers(['Pay '+i]);await h.ui.load();}h.providers(['Pay 5']);await h.ui.load();assert.equal(h.calls.length,6);h.providers(['Pay 0']);await h.ui.load();assert.equal(h.calls.length,7,'six entries exceed four MiB, so the oldest is gone');
});
