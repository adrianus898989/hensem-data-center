// Pure VM fixtures: no network, credentials or real configuration writes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-configuration.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(handler,changed=async()=>{}){
 const nodes=new Map(),calls=[],fields=new Map(),listeners=new Map(),message={textContent:''},buttons=[{disabled:false},{disabled:false}];let page='provider_config',renders=0;
 const make=()=>({id:'',className:'',innerHTML:'',querySelector(selector){if(selector==='.config-message')return message;if(selector.startsWith('#config-')){if(!fields.has(selector))fields.set(selector,{value:'Synthetic value',checked:true});return fields.get(selector)}return {focus(){}}},querySelectorAll:()=>buttons,remove(){nodes.delete(this.id)}});
 const L={providerConfigError:'',platformAssignmentsError:'',providerConfig:{canManage:true,canGrant:true,rows:[{country:'印度',platform:'Synthetic',rawProvider:'Synthetic source',canonicalProvider:'Synthetic provider',version:1}],options:{canonicalProviders:[]}}};
 const c={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name)},document:{getElementById:id=>nodes.get(id)||null,createElement:make,body:{appendChild(node){nodes.set(node.id,node)}}}};c.window=c;vm.createContext(c);vm.runInContext(source,c);
 const api=c.HensemLiveConfiguration.create({L,E:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),page:()=>page,request:q=>{calls.push(JSON.parse(JSON.stringify(q)));return handler(q)},render(){renders++},changed});
 return {c,L,api,nodes,calls,fields,message,buttons,listeners,setPage:value=>page=value,renders:()=>renders};
}

test('permission read is shared and a page departure discards its late success',async()=>{
 const pending=deferred(),h=setup(()=>pending.promise),a=h.c.configPermissions(),b=h.c.configPermissions();assert.equal(a,b);await flush();assert.equal(h.calls.length,1);
 assert.equal(h.api.pause(),true);h.setPage('overview');pending.resolve({rows:[{username:'Synthetic',canView:true,canManage:true}]});await a;
 assert.equal(h.nodes.size,0);assert.equal(h.renders(),0);assert.equal(h.L.providerConfigError,'');
});

test('closing or disposing an outstanding permission read discards both late success and late failure',async()=>{
 for(const operation of ['close','dispose'])for(const fail of [false,true]){
  const pending=deferred(),h=setup(()=>pending.promise),read=h.c.configPermissions();await flush();
  if(operation==='close')h.c.configClose();else h.api.dispose();
  if(fail)pending.reject(Error('Synthetic stale failure'));else pending.resolve({rows:[]});await read;
  assert.equal(h.nodes.size,0);assert.equal(h.renders(),0);assert.equal(h.L.providerConfigError,'');
 }
});

test('opening an edit dialog supersedes a pending permission dialog and navigation removes its DOM',async()=>{
 const pending=deferred(),h=setup(()=>pending.promise),read=h.c.configPermissions();await flush();h.c.configEditProvider(0);
 const host=h.nodes.get('liveConfigDialog');assert(host);assert.match(host.innerHTML,/三方归类/);pending.resolve({rows:[]});await read;assert.equal(h.nodes.get('liveConfigDialog'),host);
 assert.equal(h.api.pause(),true);assert.equal(h.nodes.size,0);h.setPage('overview');h.c.configEditProvider(0);await h.c.configPermissions();assert.equal(h.nodes.size,0);assert.equal(h.calls.length,1,'a stale page action cannot reopen a configuration dialog');
});

test('saving stays busy through its follow-up refresh and duplicate save never emits another write',async()=>{
 const write=deferred(),refresh=deferred();let refreshed=0;const h=setup(()=>write.promise,async()=>{refreshed++;await refresh.promise});h.c.configEditProvider(0);
 const saving=h.c.configSave();assert.equal(h.api.isSaving(),true);assert.equal(h.api.pause(),false);h.c.configClose();assert(h.nodes.has('liveConfigDialog'));await h.c.configSave();assert.equal(h.calls.length,1);
 write.resolve({ok:true});await flush();assert.equal(refreshed,1);assert.equal(h.nodes.size,0);assert.equal(h.api.isSaving(),true,'navigation remains blocked until cache refresh settles');
 refresh.resolve();await saving;assert.equal(h.api.isSaving(),false);assert.equal(h.calls[0].action,'configurationWrite');assert.equal(h.calls[0].operation,'provider');
});

test('a failed write keeps the edit retryable; a successful write with failed refresh reports its actual outcome',async()=>{
 const failed=setup(async()=>{throw Error('Synthetic write failure')});failed.c.configEditProvider(0);await failed.c.configSave();assert.equal(failed.api.isSaving(),false);assert(failed.nodes.has('liveConfigDialog'));assert.equal(failed.message.textContent,'Synthetic write failure');assert(failed.buttons.every(x=>x.disabled===false));
 const refreshed=setup(async()=>({ok:true}),async()=>{throw Error('Synthetic refresh failure')});refreshed.c.configEditProvider(0);await refreshed.c.configSave();assert.equal(refreshed.api.isSaving(),false);assert.equal(refreshed.nodes.size,0);assert.match(refreshed.L.providerConfigError,/已保存，目录刷新未完成/);assert.equal(refreshed.renders(),1);
});

test('disposing during a grant write sends no later grants and cannot refresh a replacement page',async()=>{
 const write=deferred();let refreshed=0;const h=setup(q=>q.action==='configurationAccess'?{rows:[{userId:'synthetic-a',username:'A',canManage:false},{userId:'synthetic-b',username:'B',canManage:false}]}:write.promise,async()=>{refreshed++});
 await h.c.configPermissions();const saving=h.c.configSave();assert.equal(h.calls.filter(q=>q.action==='configurationWrite').length,1);h.api.dispose();h.setPage('overview');write.resolve({ok:true});await saving;
 assert.equal(h.calls.filter(q=>q.action==='configurationWrite').length,1);assert.equal(refreshed,0);assert.equal(h.nodes.size,0);assert.equal(h.api.isSaving(),false);
});

test('iframe pagehide releases its listener and pending read; a cached document can resume after a paused read',async()=>{
 const pending=deferred(),h=setup(()=>pending.promise),read=h.c.configPermissions();await flush();h.listeners.get('pagehide')({persisted:false});assert.equal(h.listeners.size,0);pending.resolve({rows:[]});await read;assert.equal(h.nodes.size,0);await h.c.configPermissions();assert.equal(h.calls.length,1);
 const cached=setup(async()=>({rows:[]}));cached.listeners.get('pagehide')({persisted:true});assert.equal(cached.listeners.size,1);await cached.c.configPermissions();assert(cached.nodes.has('liveConfigDialog'),'bfcache restoration retains a usable controller');cached.api.dispose();assert.equal(cached.listeners.size,0);
});
