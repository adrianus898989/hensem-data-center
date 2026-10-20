const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),text=fs.readFileSync(path.join(root,'src/lib/dashboardRelease.ts'),'utf8');
const source=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const OLD='a'.repeat(64),NEW='b'.repeat(64),flush=()=>new Promise(r=>setImmediate(r));
const json=(revision=OLD,patch={})=>({ok:true,headers:{get:()=> 'application/json; charset=utf-8'},json:async()=>({version:1,revision}),...patch});
function fixture({hidden=false,revision=OLD,basePath='/hensem-data-center',handler=async()=>json()}={}){
 let clock=1000,id=0,updates=0,read=handler;
 const timers=new Map(),listeners=new Map(),calls=[],m={exports:{}};
 const document={visibilityState:hidden?'hidden':'visible',addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n)}};
 const window={setInterval:(fn,ms)=>{timers.set(++id,{fn,ms,repeat:true});return id},clearInterval:n=>timers.delete(n),setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms,repeat:false});return id},clearTimeout:n=>timers.delete(n)};
 vm.runInNewContext(source,{module:m,exports:m.exports,Date:{now:()=>clock},AbortController,document,window,fetch:async(url,options)=>{calls.push({url,options});return read(url,options)}});
 const stop=m.exports.installDashboardReleaseCheck({currentRevision:revision,basePath,onUpdate:()=>updates++});
 return{stop,calls,timers,listeners,get updates(){return updates},setHandler:fn=>read=fn,visible(value){document.visibilityState=value?'visible':'hidden';listeners.get('visibilitychange')?.()},advance(ms){clock+=ms},fire(ms){const item=[...timers].find(([,v])=>v.ms===ms);assert(item,'timer '+ms);if(!item[1].repeat)timers.delete(item[0]);item[1].fn()}};
}
test('same code stays silent; a changed valid revision notifies once and stops checking',async()=>{
 const h=fixture();await flush();assert.equal(h.calls.length,1);assert.equal(h.updates,0);
 assert.equal(h.calls[0].url,'/hensem-data-center/dashboard-release.json');
 assert.equal(h.calls[0].options.cache,'no-store');assert.equal(h.calls[0].options.credentials,'omit');assert.equal(h.calls[0].options.redirect,'error');
 h.setHandler(async()=>json(NEW));h.advance(300000);h.fire(300000);await flush();
 assert.equal(h.updates,1);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
 h.visible(true);h.stop();assert.equal(h.updates,1);
});
test('hidden pages do not poll and visibility bursts stay at one read per five minutes',async()=>{
 const h=fixture({hidden:true,basePath:''});assert.equal(h.calls.length,0);
 h.visible(true);await flush();assert.equal(h.calls[0].url,'/dashboard-release.json');
 for(let i=0;i<8;i++){h.visible(false);h.visible(true)}await flush();assert.equal(h.calls.length,1);
 h.advance(300000);h.visible(false);h.fire(300000);await flush();assert.equal(h.calls.length,1);
 h.visible(true);await flush();assert.equal(h.calls.length,2);h.stop();
});
test('a stalled fetch is aborted at ten seconds and a late new revision cannot notify',async()=>{
 let resolve;const h=fixture({handler:()=>new Promise(r=>resolve=r)});await flush();
 h.advance(300000);h.fire(300000);h.visible(true);assert.equal(h.calls.length,1,'one active request');
 h.fire(10000);await flush();assert(h.calls[0].options.signal.aborted);
 resolve(json(NEW));await flush();assert.equal(h.updates,0);
 h.setHandler(async()=>json());h.fire(300000);await flush();assert.equal(h.calls.length,2);h.stop();assert.equal(h.timers.size,0);
});
test('the deadline also covers stalled body reads and cancellation settles them without notifications',async()=>{
 let body;const h=fixture({handler:async()=>json(OLD,{json:()=>new Promise(r=>body=r)})});await flush();
 h.fire(10000);await flush();body({version:1,revision:NEW});await flush();assert.equal(h.updates,0);h.stop();assert.equal(h.timers.size,0);
 let late;const cancelled=fixture({handler:()=>new Promise(r=>late=r)});await flush();cancelled.stop();await flush();
 assert(cancelled.calls[0].options.signal.aborted);assert.equal(cancelled.timers.size,0);assert.equal(cancelled.listeners.size,0);
 late(json(NEW));await flush();assert.equal(cancelled.updates,0);
});
test('errors, redirects, HTML, malformed and extended manifests are not update evidence',async()=>{
 const replies=[
 ()=>Promise.reject(Error('network unavailable')),
 async()=>json(NEW,{ok:false}),
 async()=>json(NEW,{headers:{get:()=> 'text/html'}}),
 async()=>json(NEW,{json:async()=>{throw Error('bad json')}}),
 async()=>json('not-a-code-fingerprint'),
 async()=>json(NEW,{json:async()=>({version:2,revision:NEW})}),
 async()=>json(NEW,{json:async()=>({version:1,revision:NEW,redirect:'https://other.example'})}),
 async()=>json(NEW,{json:async()=>[NEW]}),
 ];
 for(const handler of replies){const h=fixture({handler});await flush();assert.equal(h.updates,0);assert.equal(h.timers.size,1);h.stop();}
});
test('invalid embedded revisions or nonlocal paths cannot start network work',()=>{
 for(const options of [{revision:''},{revision:'main'},{basePath:'https://other.example'},{basePath:'//other.example'},{basePath:'/a//b'}]){
  const h=fixture(options);assert.equal(h.calls.length,0);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);h.stop();
 }
});
test('an unmounted account cannot notify after a new authorized mount starts',async()=>{
 let resolve;const old=fixture({handler:()=>new Promise(r=>resolve=r)});await flush();old.stop();
 const current=fixture();await flush();resolve(json(NEW));await flush();assert.equal(old.updates,0);assert.equal(current.updates,0);assert.equal(current.calls.length,1);current.stop();
});
test('authorized host mounts a single independent checker and reload remains a user click',()=>{
 const host=fs.readFileSync(path.join(root,'src/components/OwnerAdminPreview.tsx'),'utf8');
 assert.equal((host.match(/return installDashboardReleaseCheck\(/g)||[]).length,1);
 assert.match(host,/if\(!allowed\|\|!hasDocument\|\|suspended\)return;\s*return installDashboardReleaseCheck/);
 assert.match(host,/onClick=\{\(\)=>window\.location\.reload\(\)\}/);
 assert.equal((host.match(/window\.location\.reload\(\)/g)||[]).length,1);
 assert.match(host,/window\.setInterval\(verify,60000\)/,'authorization interval is unchanged');
 assert.doesNotMatch(text,/location\.|localStorage|sessionStorage|access_token|refresh_token|setDocumentHtml/);
});
test('build manifest has a stable code-only fingerprint, changes with code and excludes local secrets',async()=>{
 const {writeDashboardRelease}=await import(pathToFileURL(path.join(root,'scripts/dashboard-release.mjs')).href);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hensem-release-test-'));
 try{
  for(const dir of ['src/lib','admin-preview','scripts'])fs.mkdirSync(path.join(temp,dir),{recursive:true});
  const files={'src/lib/example.ts':'export const x=1;','admin-preview/example.js':'var y=1;','admin-preview/build-restoration.py':'# builder','scripts/dashboard-release.mjs':'// builder','next.config.mjs':'// config','package.json':'{}','pnpm-lock.yaml':'lockfileVersion: 9'};
  for(const [name,value]of Object.entries(files))fs.writeFileSync(path.join(temp,name),value);
  fs.writeFileSync(path.join(temp,'.env.local'),'PRIVATE_VALUE=never-public');
  const first=writeDashboardRelease(temp),payload=fs.readFileSync(path.join(temp,'public/dashboard-release.json'),'utf8');
  assert.match(first,/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(payload),{version:1,revision:first});assert.equal(writeDashboardRelease(temp),first);
  fs.writeFileSync(path.join(temp,'.env.local'),'PRIVATE_VALUE=changed');assert.equal(writeDashboardRelease(temp),first);
  fs.writeFileSync(path.join(temp,'src/lib/example.ts'),'export const x=2;');assert.notEqual(writeDashboardRelease(temp),first);
  assert.doesNotMatch(payload,/PRIVATE_VALUE|never-public|src|example/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
