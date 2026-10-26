const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),compile=name=>ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const auth=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
const verification=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/ownerPreviewVerification.ts'));
const session={user:{id:'synthetic-account'},access_token:'old'},official='https://data-center.workdesk-hub.workers.dev';
const policy={mode:'assigned',roleId:'33333333-3333-4333-8333-333333333333',roleName:'Read only',version:2,canView:true,permissions:['auto_withdraw.view','auto_withdraw.query']};
function harness(origin=official,options={}){
 const calls=[],modules={};const context={URL,AbortController,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://source.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public'}},
 ...(origin?{window:{location:{origin}}}:{}),fetch:async(url,init)=>{calls.push({url,init});return Response.json(url.includes('role')?policy:{ok:true,canView:true,canManage:false},{status:options.status||200});}};
 const load=name=>{if(modules[name])return modules[name];const m={exports:{}};vm.runInNewContext(compile(name),{...context,module:m,exports:m.exports,require:specifier=>{
   if(specifier==='./dashboardEntryTransport')return load('dashboardEntryTransport');
   if(specifier==='./ownerPreviewVerification')return verification;
   if(specifier==='./dashboardRoleCatalog.json')return{default:JSON.parse(fs.readFileSync(path.join(root,'src/lib/dashboardRoleCatalog.json'),'utf8'))};
   if(specifier==='./dashboardAuthClient')return{dashboardResponseError:auth.dashboardResponseError,ensureDashboardSession:async s=>({...s,access_token:'fresh',user:{id:options.changed?'other':s.user.id}})};
   throw Error(specifier);
 }});return modules[name]=m.exports;};
 return {calls,preview:load('adminPreviewClient'),role:load('dashboardRoleAccess')};
}
test('official entry uses same-origin fixed reads, fresh same-account session and original cancellation',async()=>{
 const h=harness(),controller=new AbortController(),observed=[];
 await h.role.readDashboardRoleAccess(session,controller.signal,s=>observed.push(s));
 for(const query of ['', '?check=1','?action=access'])await h.preview.adminPreviewRequest(session,query,{signal:controller.signal,cache:'force-cache',redirect:'follow',credentials:'include'},s=>observed.push(s));
 assert.deepEqual(h.calls.map(c=>c.url),['/hensem-data-center/api/dashboard-role-access','/hensem-data-center/api/dashboard-preview','/hensem-data-center/api/dashboard-preview?check=1','/hensem-data-center/api/dashboard-preview?action=access']);
 assert.equal(h.calls[0].init.body,'{}');assert.equal(h.calls[0].init.method,'POST');assert.equal(observed.length,4);
 for(const {init}of h.calls){assert.equal(init.headers.Authorization,'Bearer fresh');assert.equal(init.signal,controller.signal);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');}
});
test('grants, mutations and other query shapes retain original authenticated endpoints',async()=>{
 const h=harness();
 for(const [query,method] of [['?action=grants&offset=0&limit=10','GET'],['?action=grants','POST'],['?action=access','POST'],['?check=1&extra=yes','GET'],['','HEAD']]){
   await h.preview.adminPreviewRequest(session,query,{method,...(method==='POST'?{body:'{}'}:{})});
   assert.equal(h.calls.at(-1).url,'https://source.invalid/functions/v1/owner-admin-preview'+query);assert.equal(h.calls.at(-1).init.method,method);
 }
});
test('SSR, backup and lookalike origins do not receive tokens through an arbitrary host',async()=>{
 for(const origin of [null,'https://adrianus898989.github.io','http://data-center.workdesk-hub.workers.dev','https://data-center.workdesk-hub.workers.dev.evil.invalid','https://other.invalid']){
   const h=harness(origin);await h.role.readDashboardRoleAccess(session);await h.preview.adminPreviewRequest(session);
   assert(h.calls.every(c=>c.url.startsWith('https://source.invalid/')));
 }
});
test('denials, temporary failures, cancellation and account changes never retry another transport',async()=>{
 for(const status of [401,403,503])for(const kind of ['preview','role']){
   const h=harness(official,{status});await assert.rejects(kind==='preview'?h.preview.adminPreviewRequest(session):h.role.readDashboardRoleAccess(session),e=>e.status===status);
   assert.equal(h.calls.length,1);assert(h.calls[0].url.startsWith('/hensem-data-center/api/'));
 }
 for(const changed of [false,true]){
   const h=harness(official,{changed}),abort=new AbortController();if(!changed)abort.abort();
   await assert.rejects(h.role.readDashboardRoleAccess(session,abort.signal));await assert.rejects(h.preview.adminPreviewRequest(session,'',{signal:abort.signal}));assert.equal(h.calls.length,0);
 }
});
