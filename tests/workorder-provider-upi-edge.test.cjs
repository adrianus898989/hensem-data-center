const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');const{createHash,webcrypto}=require('node:crypto');globalThis.crypto=webcrypto;
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/workorder-followup-data/handler.ts'),'utf8');const m={exports:{}};new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const actor='10000000-0000-0000-0000-000000000001';const proxy='SYNTHETIC-PROXY';const hash=createHash('sha256').update(proxy).digest('hex');
const identity={ok:true,identity_kind:'workorder',account:{auth_user_id:actor,role:'agent',team:'M8',platforms:['PLATFORM-A'],active:true},catalog:{platformTeams:{'PLATFORM-A':'M8'}}};
function edge(options={}){const calls=[];const gateway={identify:async()=>options.identity??identity,list:async()=>({rows:[],total:0}),mirror:async()=>true,upi:async(...args)=>{calls.push(args);return options.result??{ok:true,version:1,platform:'PLATFORM-A',providers:['Pay-A'],canAdd:true};}};const handle=m.exports.createWorkorderFollowupHandler(gateway,{proxyKeySha256:hash});const request=(body,headers={})=>handle(new Request('https://synthetic.invalid/edge',{method:'POST',headers:{Authorization:'Bearer SYNTHETIC-ONLY','content-type':'application/json','x-portal-proxy-key':proxy,'x-portal-client-ip':'192.0.2.17',...headers},body:JSON.stringify(body)}));return{calls,request};}
test('new directory action forwards only the verified caller, keeping proxy/login checks and original owner denial',async()=>{
 const h=edge();assert.equal((await h.request({action:'upi-catalog',platform:'PLATFORM-A'})).status,200);assert.deepEqual(h.calls,[[actor,{action:'catalog',platform:'PLATFORM-A'}]]);
 for(const headers of [{Authorization:''},{origin:'https://synthetic.invalid'},{'x-portal-proxy-key':'wrong'}]){const h=edge();assert([401,403].includes((await h.request({action:'upi-list',platform:'PLATFORM-A',provider:'Pay-A'},headers)).status));assert.equal(h.calls.length,0);}
 for(const extra of [{p_actor:actor},{role:'owner'},{platforms:['PLATFORM-B']}]){const h=edge();assert.equal((await h.request({action:'upi-add',platform:'PLATFORM-A',provider:'Pay-A',upiId:'synthetic@bank',...extra})).status,400);assert.equal(h.calls.length,0);}
 const owner={...identity,identity_kind:'dashboard_owner',account:{...identity.account,role:'owner',team:''}};assert.equal((await edge({identity:owner}).request({action:'upi-catalog',platform:'PLATFORM-A'})).status,200);assert.equal((await edge({identity:owner}).request({action:'list'})).status,403);
});
test('structured expected conflict survives existing proxy client while provider membership is rechecked by SQL',async()=>{
 const expected={ok:false,version:1,platform:'PLATFORM-A',code:'upi_provider_mismatch',matchedProviders:['Pay-B']};const h=edge({result:expected});assert.deepEqual(await(await h.request({action:'upi-add',platform:'PLATFORM-A',provider:'Pay-A',upiId:'synthetic@bank'})).json(),expected);
});
test('inactive staff and a conflicting fresh team/catalog cannot invoke the directory DB gateway',async()=>{
 for(const value of [{...identity,account:{...identity.account,active:false}},{...identity,catalog:{platformTeams:{'PLATFORM-A':'M9'}}},{...identity,account:{...identity.account,role:'owner'}}]){const h=edge({identity:value});assert.equal((await h.request({action:'upi-catalog',platform:'PLATFORM-A'})).status,403);assert.equal(h.calls.length,0);}
});
test('old list results and authorization remain byte-equivalent to the production Edge handler',async()=>{
 const base={exports:{}};const s=fs.readFileSync(path.join(__dirname,'fixtures/workorder-provider-upi-original-edge-handler.ts'),'utf8');new Function('module','exports',ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(base,base.exports);
 const gateway={identify:async()=>identity,list:async()=>({rows:[],total:0,facets:{}}),mirror:async()=>true};
 const call=async create=>create(gateway,{proxyKeySha256:hash})(new Request('https://synthetic.invalid/followup',{method:'POST',headers:{Authorization:'Bearer SYNTHETIC-ONLY','content-type':'application/json','x-portal-proxy-key':proxy,'x-portal-client-ip':'192.0.2.17'},body:JSON.stringify({action:'list'})}));
 assert.deepEqual(await(await call(m.exports.createWorkorderFollowupHandler)).json(),await(await call(base.exports.createWorkorderFollowupHandler)).json());
});

