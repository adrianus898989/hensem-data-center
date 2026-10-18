// Exercise the actual controller's cache with synthetic JSON only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8'),ast=ts.createSourceFile('live-data.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let declaration;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='createWorkorderExactCache')declaration=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(declaration);
const create=new Function(declaration+';return createWorkorderExactCache;')();
const clone=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const query=(more={})=>({action:'workorders',startAt:'2026-10-11T00:00:00.000Z',endAt:'2026-10-17T23:59:59.000Z',country:'印度',platforms:['Synthetic A'],providers:['SyntheticPay'],direction:'charge',offset:0,limit:20,...more});
const value=(more={})=>({rows:[],total:0,byProvider:[{provider:'SyntheticPay',uniqueOrderAmount:'9007199254740993.00000001',uniqueSuccessAmount:null,uniqueOrderCount:null,uniqueCoverage:{status:'unavailable',complete:false}}],byDirection:{charge:{uniqueOrderCount:null}},coverage:{complete:false,capturedPlatformDays:5,expectedPlatformDays:7},sourceUpdatedAt:'2026-10-18T01:23:45.123456Z',...more});
const cancelled=error=>error.code==='ADMIN_LIVE_CANCELLED';
function harness(){let context='providers|actor-a|view+query|role-v1',identity='native-A|ar|SOURCE_A|INR|cap-v1',clock=1000,handler=()=>value();const calls=[];const cache=create({context:()=>context,identity:()=>identity,now:()=>clock,request:(q,options)=>{calls.push({q,options});return handler(q,options);}});return{cache,calls,context:v=>context=v,identity:v=>identity=v,clock:v=>clock=v,handler:v=>handler=v};}
test('exact completed responses preserve raw JSON, decimal/null/coverage/source times and independent clones',async()=>{
 const h=harness(),a=await h.cache.read(query()),expected=clone(a);a.byProvider[0].uniqueOrderAmount='mutated';a.coverage.complete=true;const b=await h.cache.read(Object.fromEntries(Object.entries(query()).reverse()));assert.equal(h.calls.length,1);assert.deepEqual(b,expected);assert.equal(b.coverage.complete,false);assert.equal(b.byProvider[0].uniqueCoverage.status,'unavailable');
});
test('all request filters, pagination and provider unions stay separate with no local projection',async()=>{
 const h=harness(),requests=[query(),query({providers:[]}),query({providers:['SyntheticPay','OtherPay']}),query({platforms:['Synthetic B']}),query({startAt:'2026-10-12T00:00:00.000Z'}),query({endAt:'2026-10-16T23:59:59.000Z'}),query({direction:'all'}),query({offset:20}),query({limit:50})];for(const q of requests)await h.cache.read(q);assert.equal(h.calls.length,requests.length);await h.cache.read(requests.at(-1));assert.equal(h.calls.length,requests.length);
});
test('ordinary duplicate reads share a request, and a late first waiter cannot publish over the current waiter',async()=>{
 const h=harness(),wait=deferred();let firstCurrent=true;h.handler(()=>wait.promise);const a=h.cache.read(query(),{isCurrent:()=>firstCurrent}),rejected=assert.rejects(a,cancelled),b=h.cache.read(query());await tick();assert.equal(h.calls.length,1);firstCurrent=false;wait.resolve(value());await rejected;assert.deepEqual(await b,value());await h.cache.read(query());assert.equal(h.calls.length,1);
});
test('force bypasses completed and active ordinary reads, while duplicate force joins one fresh request',async()=>{
 const h=harness();await h.cache.read(query());await h.cache.read(query(),{force:true});assert.equal(h.calls.length,2);const old=deferred(),fresh=deferred();h.cache.clear();h.handler(()=>old.promise);const a=h.cache.read(query()),rejected=assert.rejects(a,cancelled);await tick();h.handler(()=>fresh.promise);const b=h.cache.read(query(),{force:true}),c=h.cache.read(query(),{force:true});await rejected;await tick();assert.equal(h.calls.length,4);assert.equal(h.calls[2].options.signal.aborted,true);fresh.resolve(value({sourceUpdatedAt:'fresh'}));assert.deepEqual(await b,await c);old.resolve(value({sourceUpdatedAt:'old'}));await tick();assert.equal((await h.cache.read(query())).sourceUpdatedAt,'fresh');assert.equal(h.calls.length,4);
});
test('the original thirty-second receipt expires without renewal, including a cached delivery microtask',async()=>{
 const h=harness();await h.cache.read(query());h.clock(30999);await h.cache.read(query());assert.equal(h.calls.length,1);const pending=h.cache.read(query());h.clock(31000);await pending;assert.equal(h.calls.length,2);h.clock(30999);await h.cache.read(query());assert.equal(h.calls.length,3,'clock rollback never extends a cached result');
});
test('eight-entry LRU and byte bounds evict old or oversized JSON responses',async()=>{
 const h=harness();for(let n=0;n<9;n++)await h.cache.read(query({providers:['Synthetic-'+n]}));await h.cache.read(query({providers:['Synthetic-8']}));assert.equal(h.calls.length,9);await h.cache.read(query({providers:['Synthetic-0']}));assert.equal(h.calls.length,10);
 const big=harness();big.handler(()=>value({evidence:'x'.repeat(1100000)}));await big.cache.read(query());await big.cache.read(query());assert.equal(big.calls.length,2);
 const bytes=harness();bytes.handler(()=>value({evidence:'x'.repeat(700000)}));for(let n=0;n<7;n++)await bytes.cache.read(query({offset:n*20}));await bytes.cache.read(query());assert.equal(bytes.calls.length,8,'eight MiB evicts large entries before the eight-entry cap');
});
test('replaced current predicates stop queued and active different-scope work without waiting for transport',async()=>{
 for(const active of [false,true]){const h=harness(),old=deferred();let current=true;h.handler(()=>old.promise);const a=h.cache.read(query(),{isCurrent:()=>current}),rejected=assert.rejects(a,cancelled);if(active)await tick();current=false;h.handler(()=>value());await h.cache.read(query({offset:20}));await rejected;assert.equal(h.calls.length,active?2:1);assert(h.calls.filter(x=>x.q.offset===0).every(x=>x.options.signal.aborted));old.resolve(value());await tick();}
});
test('cancel preserves completed peers but settles queued and abort-ignoring active work without late refill',async()=>{
 for(const active of [false,true]){const h=harness(),old=deferred();await h.cache.read(query());h.handler(()=>old.promise);const request=query({providers:['OtherPay']}),p=h.cache.read(request),rejected=assert.rejects(p,cancelled);if(active)await tick();h.cache.cancel();await rejected;assert(h.calls.filter(x=>x.q.providers[0]==='OtherPay').every(x=>x.options.signal.aborted));old.resolve(value());await tick();await h.cache.read(query());assert.equal(h.calls.length,active?2:1);h.handler(()=>value());await h.cache.read(request);assert.equal(h.calls.length,active?3:2);}
});
test('clear, page/actor/permission context and native identity changes cannot reuse or deliver old JSON',async()=>{
 for(const change of ['clear','context','identity','current']){const h=harness();await h.cache.read(query());let current=true;const p=h.cache.read(query(),{isCurrent:()=>current}),rejected=assert.rejects(p,cancelled);if(change==='clear')h.cache.clear();if(change==='context')h.context('overview|actor-b|view+query|role-v2');if(change==='identity')h.identity('native-A|newar|OTHER_SOURCE|INR|cap-v2');if(change==='current')current=false;await rejected;}
 const h=harness();await h.cache.read(query());h.context('');await assert.rejects(h.cache.read(query()),cancelled);h.context('providers|actor-a|view+query|role-v1');await h.cache.read(query());assert.equal(h.calls.length,2);
});
test('authority errors clear completed peers and preserve the original permission code',async()=>{
 for(const code of ['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED']){const h=harness();await h.cache.read(query());h.handler(()=>{throw Object.assign(Error('denied'),{code});});await assert.rejects(h.cache.read(query({providers:['DeniedPay']})),e=>e.code===code);h.handler(()=>value());await h.cache.read(query());assert.equal(h.calls.length,3);}
});
test('transport/calculation partial, failed and invalidated responses never become completed cache entries',async()=>{
 for(const patch of [{partial:true},{complete:false},{available:false},{error:'incomplete'},{meta:{partial:true}}]){const h=harness();h.handler(()=>value(patch));await h.cache.read(query());await h.cache.read(query());assert.equal(h.calls.length,2);}
 const h=harness();h.handler(()=>value());const validate=()=>{throw Error('invalid shape');};await assert.rejects(h.cache.read(query(),{validate}));await assert.rejects(h.cache.read(query(),{validate}));assert.equal(h.calls.length,2);
});
