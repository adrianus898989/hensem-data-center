const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/dashboardAuthClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ACTOR='11111111-1111-4111-8111-111111111111',NEW='22222222-2222-4222-8222-222222222222',ROLE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BR={mode:'selected',countries:['BR_PANGHU']};
const session={user:{id:ACTOR},access_token:'synthetic-only-token',refresh_token:'synthetic-only-refresh',expires_at:4102444800};
const response={ok:true,account:{auth_user_id:NEW,username:'synthetic-new',role:'viewer',active:true,role_id:ROLE,role_name:'Empty role',role_version:7,assignment_version:1,data_scope:BR}};
const plain=value=>JSON.parse(JSON.stringify(value));
function client(body=response,options={}){
 const module={exports:{}},calls=[];
 vm.runInNewContext(source,{module,exports:module.exports,console,Error,AbortController,setTimeout,clearTimeout,Headers,URL,URLSearchParams,Date,Set,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public'}},fetch:async(url,init)=>{calls.push({url,init:{...init,signal:null},body:init.body?JSON.parse(init.body):null});if(options.fetch)return options.fetch(url,init,module.exports);return new Response(typeof body==='string'?body:JSON.stringify(body),{status:options.status||200})}});
 return{auth:module.exports,calls,create:(role={id:ROLE,version:7},scope=BR,password='synthetic-password')=>module.exports.createDashboardRoleAccount(session,' Synthetic-New ',password,role,scope)};
}
test('new creation client sends only explicit actual role/version/scope and validates authoritative created identity',async()=>{
 const c=client();const result=await c.create({id:ROLE.toUpperCase(),version:7});assert.deepEqual(plain(result),response);assert.equal(c.calls.length,1);assert.equal(c.calls[0].url,'https://fixture.invalid/functions/v1/dashboard-user-admin');assert.deepEqual(c.calls[0].body,{action:'create-role-account',username:'synthetic-new',password:'synthetic-password',role_id:ROLE,role_version:7,data_scope:BR});assert.equal(c.calls[0].init.headers.Authorization,'Bearer '+session.access_token);assert.equal(c.calls[0].init.redirect,'error');assert.equal(c.calls[0].init.credentials,'omit');
});
test('creation client rejects missing/old role selectors and invalid data ranges without sending a mutation',async()=>{
 for(const role of [null,{}, {id:'viewer',version:7},{id:ROLE,version:0},{id:ROLE,version:'7'}]){const c=client();await assert.rejects(c.create(role),/新版角色/);assert.equal(c.calls.length,0);}
 for(const scope of [null,{}, {mode:'all'}, {mode:'selected',countries:[]},{mode:'selected',countries:['invalid']},{...BR,extra:true},{mode:'selected',countries:['BR_PANGHU','BR_PANGHU']}]){const c=client();await assert.rejects(c.create(undefined,scope),/数据范围/);assert.equal(c.calls.length,0);}
});
test('unknown or mismatched creation acknowledgements cannot become success; no mutation is automatically retried',async()=>{
 for(const body of [{}, {ok:true},{...response,ok:false},'invalid JSON',...[
  {auth_user_id:ACTOR},{auth_user_id:'invalid'}, {username:'someone-else'},{role:'admin'},{active:false},{role_id:NEW},{role_name:''},{role_version:6},{assignment_version:0},{assignment_version:2},{data_scope:{mode:'all',countries:[]}},
 ].map(patch=>({...response,account:{...response.account,...patch}}))]){const c=client(body);await assert.rejects(c.create(),/待核对|未确认|响应|JSON|后台请求失败/);assert.equal(c.calls.length,1);}
 for(const status of [401,403,503]){const c=client({message:'Synthetic denied'}, {status});await assert.rejects(c.create(),/Synthetic denied/);assert.equal(c.calls.length,1);}
});
test('creation actor change while awaiting a response never returns the previous actors successful account',async()=>{
 let finish;const c=client(response,{fetch:()=>new Promise(resolve=>{finish=()=>resolve(Response.json(response))})});const pending=c.create();await new Promise(resolve=>setImmediate(resolve));c.auth.saveDashboardSession({...session,user:{id:NEW}});finish();await assert.rejects(pending,/登录账号已改变/);assert.equal(c.calls.length,1);
});
test('an Auth-only identity with forged role metadata and no profile is denied instead of receiving fallback Dashboard grants',async()=>{
 const c=client([]);await assert.rejects(c.auth.fetchDashboardProfile({...session,user:{id:NEW,user_metadata:{dashboard_role:'owner',role_id:ROLE}}}),error=>error.code==='profile_denied'&&error.status===403);assert.equal(c.calls.length,1);assert.match(c.calls[0].url,/dashboard_profiles/);
});
