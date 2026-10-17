// Real configuration dialog code, synthetic DOM and RPCs; no external writes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const prefix=fs.readFileSync(path.join(__dirname,'admin-configuration-lifecycle-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,deferred}=new Function('require','__dirname',prefix+';return {setup,deferred};')(require,__dirname);
function formFor(h,valid=true){
 const host=h.nodes.get('liveConfigDialog'),query=host.querySelector.bind(host);let checks=0,nativeSubmits=0;
 const form={reportValidity(){checks++;return valid},requestSubmit(){nativeSubmits++},submit(){nativeSubmits++}};
 host.querySelector=selector=>selector==='form'?form:query(selector);
 const handler=host.innerHTML.match(/<button[^>]*type="button"[^>]*onclick="(configSave\(\))"[^>]*>保存<\/button>/)?.[1];
 assert(handler,'save is an explicit non-submit button');
 return {host,click:()=>vm.runInContext(handler,h.c),checks:()=>checks,nativeSubmits:()=>nativeSubmits,setValid:value=>valid=value};
}
test('sandboxed dialog save uses an explicit button; native submit is inert and validation precedes busy or RPC',async()=>{
 const h=setup(async()=>({ok:true}));h.c.configEditProvider(0);const f=formFor(h,false);
 assert.match(f.host.innerHTML,/<form onsubmit="return false">/);assert.doesNotMatch(f.host.innerHTML,/type="submit"|onsubmit="[^"]*configSave/);assert.match(f.host.innerHTML,/maxlength="200" required/);
 const submit=f.host.innerHTML.match(/<form onsubmit="([^"]+)"/)[1];assert.equal(vm.runInContext('(function(){'+submit+'})()',h.c),false);
 await f.click();assert.equal(f.checks(),1);assert.equal(f.nativeSubmits(),0);assert.equal(h.calls.length,0);assert.equal(h.api.isSaving(),false);assert(h.buttons.every(b=>b.disabled===false));assert.equal(h.message.textContent,'');assert.equal(h.nodes.get('liveConfigDialog'),f.host);
 f.setValid(true);await f.click();assert.equal(f.checks(),2);assert.equal(f.nativeSubmits(),0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].operation,'provider');assert.equal(h.calls[0].expectedVersion,1);assert.equal(h.nodes.size,0);assert.equal(h.api.isSaving(),false);
});
test('valid platform save keeps exact source identity and version, duplicate writes stay blocked through refresh',async()=>{
 const write=deferred(),refresh=deferred();let refreshed=0;const h=setup(()=>write.promise,async type=>{assert.equal(type,'platform');refreshed++;await refresh.promise});h.setPage('teams');
 h.L.platformAssignments={canManage:true,rows:[{id:'11111111-1111-4111-8111-111111111111',mapped:true,team:'Synthetic old team',system:'LG',platform:'Synthetic display',sourceCountry:'印度',sourcePlatform:'Synthetic original',sourceSystem:'LG',countryCode:'IN',version:7}],options:{teams:['Synthetic old team','Synthetic new team'],systems:['LG'],countryChoices:[{country:'印度',code:'IN'}],sourceSystems:['LG']}};
 h.c.configEditPlatform(0);const f=formFor(h);for(const [key,value]of Object.entries({team:'Synthetic new team',system:'LG',platformName:'Synthetic display',country:'0'}))f.host.querySelector('#config-'+key).value=value;
 const saving=f.click();assert.equal(h.api.isSaving(),true);assert(h.buttons.every(b=>b.disabled));await f.click();assert.equal(h.calls.length,1);assert.equal(f.checks(),1,'a duplicate busy click does not validate or dispatch again');
 assert.deepEqual(h.calls[0],{action:'configurationWrite',operation:'platform',mappingId:'11111111-1111-4111-8111-111111111111',team:'Synthetic new team',system:'LG',platformName:'Synthetic display',country:'印度',countryCode:'IN',sourceSystem:'LG',sourceCountry:'印度',sourcePlatform:'Synthetic original',expectedVersion:7});
 write.resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(refreshed,1);assert.equal(h.api.isSaving(),true);refresh.resolve();await saving;assert.equal(h.api.isSaving(),false);assert.equal(f.nativeSubmits(),0);
});
test('write conflicts remain retryable and a departed page cannot dispatch or consume a late save',async()=>{
 const conflict=setup(async()=>{throw Error('configuration_version_conflict')});conflict.c.configEditProvider(0);const f=formFor(conflict);await f.click();assert.equal(conflict.calls.length,1);assert.equal(conflict.message.textContent,'configuration_version_conflict');assert.equal(conflict.api.isSaving(),false);assert(conflict.buttons.every(b=>b.disabled===false));assert(conflict.nodes.has('liveConfigDialog'));
 const write=deferred();let refreshed=0;const h=setup(()=>write.promise,async()=>{refreshed++});h.c.configEditProvider(0);const saving=formFor(h).click();h.api.dispose();h.setPage('overview');write.resolve({ok:true});await saving;assert.equal(refreshed,0);assert.equal(h.nodes.size,0);assert.equal(h.api.isSaving(),false);await h.c.configSave();assert.equal(h.calls.length,1);
});
