// Real host bridge, synthetic transport and accounts only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const base=process.env.SESSION_FOLLOWUP_REPO||path.resolve(__dirname,'..'),localRoot=process.env.SESSION_FOLLOWUP_CLIENT||base,baseRequire=createRequire(path.join(base,'tests/followup.cjs'));
const prefix=fs.readFileSync(path.join(base,'tests/admin-live-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0].replace("const sourceText = fs.readFileSync(filename, 'utf8');","const sourceText = fs.readFileSync("+JSON.stringify(path.join(localRoot,'src/lib/adminLiveBridge.ts'))+", 'utf8');");
const {load,bridge,flush,query}=new Function('require','__dirname',prefix+';return {load,bridge,flush,query};')(baseRequire,path.join(base,'tests'));
test('page_action_denied is a permission denial and stops this document without turning into a revoked login',async()=>{
 for(const body of [{code:'42501',message:'page_action_denied'},{code:'page_action_denied',message:'PRIVATE_SENTINEL'}]){
  const denials=[],h=load({fetch:async()=>({ok:false,status:403,json:async()=>body})}),b=bridge(h,{onAccessDenied:kind=>denials.push(kind)});h.send(b.event());await flush();assert.deepEqual(denials,['permission']);assert.equal(b.replies[0].data.code,'ADMIN_LIVE_PERMISSION_DENIED');assert.match(b.replies[0].data.error,/当前页面/);assert.doesNotMatch(JSON.stringify(b.replies),/PRIVATE_|SESSION_DENIED/);assert.equal(h.calls.length,1);assert.equal(h.listeners.size,0);b.cleanup();
 }
});
test('real session revocation, account/IP denial and unknown 403 still fail closed without replay',async()=>{
 for(const [status,body] of [[401,{code:'42501',message:'page_action_denied'}],[403,{code:'application_session_denied'}],[403,{code:'ip_denied'}],[403,{message:'account_disabled'}],[403,{message:'PRIVATE_SENTINEL'}]]){
  const denials=[],h=load({fetch:async()=>({ok:false,status,json:async()=>body})}),b=bridge(h,{onAccessDenied:kind=>denials.push(kind)});h.send(b.event());await flush();assert.deepEqual(denials,['session']);assert.equal(b.replies[0].data.code,'ADMIN_LIVE_SESSION_DENIED');assert.equal(h.calls.length,1);assert.equal(h.listeners.size,0);b.cleanup();
 }
});
test('transport, lock wait and database timeouts do not revoke the mounted session',async()=>{
 for(const options of [{fetch:async()=>({ok:false,status:500,json:async()=>({code:'57014',message:'PRIVATE_SENTINEL'})})},{fetch:async()=>{throw new TypeError('PRIVATE_SENTINEL')}},{ensure:async()=>{throw Object.assign(Error('wait'),{status:0,code:'refresh_coordination_timeout'})}}]){
  const denials=[],h=load(options),b=bridge(h,{onAccessDenied:kind=>denials.push(kind)});h.send(b.event());await flush();assert.deepEqual(denials,[]);assert.equal(h.listeners.size,1);assert.equal(b.replies.length,1);assert.notEqual(b.replies[0].data.code,'ADMIN_LIVE_SESSION_DENIED');b.cleanup();
 }
});
