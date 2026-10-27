const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {loadTs,root}=require('./load-typescript.cjs'),scopeHelpers=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
const source=ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/dashboardAuthClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const session={user:{id:'fixture-actor'},access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:4102444800};
const before={auth_user_id:'fixture-target',username:'target',role:'viewer',active:true,permissions:null,management_permissions:null,data_scope:{mode:'selected',countries:['IN']},created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-26T00:00:00Z'};
const after={...before,active:false,updated_at:'2026-10-27T00:00:00Z'};
const plain=x=>JSON.parse(JSON.stringify(x));
function client(response,options={}){
 const mod={exports:{}},calls=[];
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:name=>{assert.equal(name,'./dashboardDataScope');return scopeHelpers},console,Error,AbortController,setTimeout,clearTimeout,Headers,URL,Date,Set,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public'}},fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return options.fetch?options.fetch(url,init):Response.json(response,{status:options.status||200})}});
 return{api:mod.exports,calls,save:()=>mod.exports.updateDashboardAccount(session,'target',{active:false},before),remove:()=>mod.exports.deleteDashboardAccount(session,'target',before.auth_user_id)};
}
test('updated profile is confirmed, target-matched and restricted to the existing list projection',async()=>{
 const h=client({ok:true,account:{...after,server_internal:'must-not-escape'}});
 assert.deepEqual(plain(await h.save()),{ok:true,account:after});assert.deepEqual(h.calls,[{action:'update-account',username:'target',active:false}]);
});
test('incomplete and mismatched update acknowledgements never become local success or a repeated mutation',async()=>{
 for(const response of [{ok:true},{ok:false,account:after},...[{auth_user_id:'other'},{username:'other'},{role:'owner'},{active:true},{permissions:{home:'true'}},{management_permissions:{unrecognized:true}},{data_scope:{mode:'all'}},{updated_at:'bad'},{updated_at:'2026-10-20T00:00:00Z'}].map(patch=>({ok:true,account:{...after,...patch}}))]){
  const h=client(response);await assert.rejects(h.save(),e=>e.code==='account_update_response_invalid');assert.equal(h.calls.length,1);
 }
});
test('scope acknowledgement must match the requested countries and native platform pairs exactly',async()=>{
 const h=client({ok:true,account:{...before,data_scope:{mode:'all',countries:[]},updated_at:after.updated_at}});
 await assert.rejects(h.api.updateDashboardAccount(session,'target',{data_scope:before.data_scope},before),e=>e.code==='account_update_response_invalid');assert.equal(h.calls.length,1);
});
test('delete acknowledgement must identify the exact confirmed target',async()=>{
 const h=client({ok:true,auth_user_id:before.auth_user_id,username:'target'});assert.deepEqual(plain(await h.remove()),{ok:true,auth_user_id:before.auth_user_id,username:'target'});
 for(const response of [{ok:true},{ok:true,auth_user_id:'other',username:'target'},{ok:true,auth_user_id:before.auth_user_id,username:'other'}]){
  const bad=client(response);await assert.rejects(bad.remove(),e=>e.code==='account_delete_response_invalid');assert.equal(bad.calls.length,1);
 }
});
test('an account switch during a write prevents its previous successful acknowledgement from entering a new directory',async()=>{
 let finish;const h=client(null,{fetch:()=>new Promise(resolve=>finish=()=>resolve(Response.json({ok:true,account:after})))});
 const request=h.save();await new Promise(r=>setImmediate(r));h.api.saveDashboardSession({...session,user:{id:'different-actor'}});finish();
 await assert.rejects(request,e=>e.code==='session_changed');assert.equal(h.calls.length,1);
});
test('denied and unavailable writes are not replayed by the updated response contract',async()=>{
 for(const status of [401,403,503]){const h=client({message:'fixture denied'},{status});await assert.rejects(h.save(),/fixture denied/);assert.equal(h.calls.length,1);}
});
