const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const scopeHelpers=require('./load-typescript.cjs').loadTs(path.resolve(__dirname,'../src/lib/dashboardDataScope.ts'));
const source=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/dashboardAuthClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function client(body,status=200,fetcher){
 const module={exports:{}},calls=[];
 vm.runInNewContext(source,{module,exports:module.exports,require:name=>{assert.equal(name,'./dashboardDataScope');return scopeHelpers;},console,Error,AbortController,setTimeout,clearTimeout,Headers,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-public'}},fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return fetcher?fetcher(init):new Response(typeof body==='string'?body:JSON.stringify(body),{status})}});
 return{read:signal=>module.exports.listDashboardUsers({user:{id:'fixture-user'},access_token:'fixture-token'},signal),calls};
}
const row={auth_user_id:'fixture-user',username:'existing-user',role:'viewer',active:true,permissions:{third_party:false,work_orders:true},management_permissions:{manage_viewers:false},data_scope:{mode:'selected',countries:['IN']}};
test('account listing retains original endpoint, identity, permissions and scope without creating accounts',async()=>{
 const h=client({ok:true,users:[row]});assert.deepEqual(JSON.parse(JSON.stringify(await h.read())),[row]);assert.deepEqual(h.calls,[{url:'https://fixture.invalid/functions/v1/dashboard-user-admin',body:{action:'list-users'}}]);
});
test('only an explicitly successful empty directory is a confirmed zero',async()=>{
 assert.equal((await client({ok:true,users:[]}).read()).length,0);
 for(const body of [{},{ok:true},{ok:false,users:[]},{users:[]},{ok:true,users:null},{ok:true,users:{}},'not json'])await assert.rejects(client(body).read(),/账号列表返回不完整/);
});
test('malformed or duplicated identities fail instead of becoming partial or empty directory results',async()=>{
 for(const users of [[null],[{}],[{...row,active:'true'}],[{...row,role:'unknown'}],[{...row,auth_user_id:''}],[{...row,username:''}],[row,row]])await assert.rejects(client({ok:true,users}).read(),/账号列表返回不完整/);
});
test('authorization and service failures preserve an explicit read error',async()=>{
 for(const status of [401,403,503])await assert.rejects(client({message:'fixture denied'},status).read(),/fixture denied/);
});
test('cancelled directory read never starts or retries a request and propagates to the physical transport',async()=>{
 const before=new AbortController();before.abort();const cold=client({ok:true,users:[row]});await assert.rejects(cold.read(before.signal),{name:'AbortError'});assert.equal(cold.calls.length,0);
 let physical;const current=new AbortController(),running=client(null,200,init=>new Promise((_,reject)=>{physical=init.signal;physical.addEventListener('abort',()=>reject(physical.reason),{once:true});}));
 const request=running.read(current.signal);current.abort();await assert.rejects(request,{name:'AbortError'});assert(physical.aborted);assert.equal(running.calls.length,1);
});
