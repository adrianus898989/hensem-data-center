const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{fixture,IDS,SIDS,MIGRATION}=require('./fixtures/workorder-identity-fixture.cjs');
const signature='public.workorder_portal_identity_context(uuid,text,uuid,boolean,text)';
const deps=['application_session_check(uuid,uuid,text)','application_auth_ip_check(text,text,uuid)','workorder_portal_account_context(uuid)','workorder_portal_effective_access(uuid)','private.application_session_allowed(uuid,uuid,text)','private.application_ip_allowed(text,inet,uuid)'];
async function meta(db,sig){return(await db.query("select md5(p.prosrc) body,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig config,p.provolatile volatile,p.prosecdef secdef,pg_get_function_arguments(p.oid) args from pg_proc p where p.oid=to_regprocedure($1)",[sig])).rows[0];}
async function rollbackFailed(db){await db.exec('rollback');}
test('installer/replay creates only one service-only invoker; existing six definitions and data remain unchanged',async()=>{
 const h=await fixture({install:false});try{
  const before=await Promise.all(deps.map(s=>meta(h.db,s))),state=await h.snapshot();
  await h.db.exec(fs.readFileSync(MIGRATION,'utf8'));await h.db.exec(fs.readFileSync(MIGRATION,'utf8'));
  assert.deepEqual(await Promise.all(deps.map(s=>meta(h.db,s))),before);assert.deepEqual(await h.snapshot(),state);
  const m=await meta(h.db,signature);assert.equal(m.body,'833fdc5793f4a6ec3f2deae163fda2e7');assert.equal(m.volatile,'v');assert.equal(m.secdef,false);assert.equal(m.owner,'postgres');assert.equal(m.acl,'{postgres=X/postgres,service_role=X/postgres}');assert.deepEqual(m.config,['search_path=""']);
  for(const role of ['anon','authenticated']){await h.db.exec('set role '+role);await assert.rejects(h.db.query('select '+signature.replace(/\(.*$/,'')+'($1,$2,$3,$4,$5)',[IDS.agent,'agent@workorder.hensem.local',SIDS.agent,true,'203.0.113.7']),e=>e.code==='42501');await h.db.exec('reset role');}
  assert.equal((await h.context()).ok,true);
 }finally{await h.db.close();}
});
test('fresh enabled/locked/session expiry/revocation/IP policy reject before account and never change state',async()=>{
 const h=await fixture();try{
  let before=await h.snapshot();assert.equal((await h.context()).ok,true);assert.deepEqual(await h.snapshot(),before);
  for(const [mutate,undo,code]of [
   ["update public.workorder_portal_accounts set active=false where auth_user_id='"+IDS.agent+"'","update public.workorder_portal_accounts set active=true where auth_user_id='"+IDS.agent+"'",'session_denied'],
   ["update private.application_account_security set locked_at=now() where user_id='"+IDS.agent+"'","update private.application_account_security set locked_at=null where user_id='"+IDS.agent+"'",'session_denied'],
   ["update auth.sessions set not_after=now()-interval '1 second' where id='"+SIDS.agent+"'","update auth.sessions set not_after=null where id='"+SIDS.agent+"'",'session_denied'],
   ["update private.application_sessions set revoked_at=now() where session_id='"+SIDS.agent+"'","update private.application_sessions set revoked_at=null where session_id='"+SIDS.agent+"'",'session_denied']
  ]){await h.db.exec(mutate);before=await h.snapshot();assert.equal((await h.context({ip:null})).code,code);assert.deepEqual(await h.snapshot(),before);await h.db.exec(undo);}
  await h.db.exec("update private.application_account_security set ip_mode='allowlist' where user_id='"+IDS.agent+"';insert into private.application_account_ip_rules values('"+IDS.agent+"','workorder',true,'203.0.113.7/32');");
  assert.equal((await h.context({ip:'198.51.100.10'})).code,'ip_denied');assert.equal((await h.context({ip:null})).code,'proxy_denied');assert.equal((await h.context({sid:null,ip:null})).code,'session_denied');
  await h.db.exec("update private.application_account_ip_rules set active=false;");assert.equal((await h.context()).code,'session_denied');
 }finally{await h.db.close();}
});
test('owner old Pages path, proxy requirements, non-owner dashboard and caller-email gates are unchanged',async()=>{
 const h=await fixture();try{
  const owner={actor:IDS.owner,email:'owner@hensem.local',sid:SIDS.owner};
  assert.equal((await h.context({...owner,proxy:false,ip:null})).ok,true);assert.equal((await h.context({...owner,proxy:true,ip:null})).code,'proxy_denied');
  const admin={actor:IDS.admin,email:'admin@hensem.local',sid:SIDS.admin};assert.equal((await h.context({...admin,ip:null})).code,'proxy_denied');assert.equal((await h.context(admin)).message,'此后台账号没有工单所有者权限');
  await h.db.exec("update public.dashboard_profiles set active=false where auth_user_id='"+IDS.admin+"'");assert.equal((await h.context({...admin,ip:null})).code,'session_denied');
  for(const email of [null,'other@workorder.hensem.local','agent@hensem.local'])assert.equal((await h.context({email})).code,'account_denied');
  assert.equal((await h.context({email:'AGENT@WORKORDER.HENSEM.LOCAL'})).ok,true);
  assert.equal((await h.context({sid:SIDS.other})).code,'session_denied');
 }finally{await h.db.close();}
});
test('role and permission changes are read anew; scoped catalog and returned fields match the old account context',async()=>{
 const h=await fixture();try{
  const role=await h.callRole(IDS.owner,{action:'create-role',name:'Synthetic identity role',base_role:'agent',permissions:{'provider_upis.view':true,'provider_upis.add':true}});await h.assign(role.role.id);
  let r=await h.context();assert.equal(r.account.permissions['provider_upis.add'],true);const old=(await h.service('select public.workorder_portal_account_context($1) value',[IDS.agent]))[0].value;assert.deepEqual(r.account,old);
  await h.callRole(IDS.owner,{action:'update-role',id:role.role.id,expected_version:role.role.version,patch:{active:false}});r=await h.context();assert.equal(r.account.permissions['provider_upis.add'],false);assert.equal(r.account.permissions['provider_upis.view'],false);
  assert.deepEqual(Object.keys(r.profile||{}),[]);assert(!JSON.stringify(r).includes('created_by'));assert(!JSON.stringify(r).includes('login_ip'));assert(!JSON.stringify(r).includes('session_id'));
  await h.db.exec("insert into public.game66_platforms(team_name,platform_name,enabled)values('香港','REGISTERED-PAUSED',false),('foreign','INVISIBLE',true);insert into public.dashboard_platform_team_map(country_code,team_name,platform_name,active)values('PK','M8','FOREIGN',true),('IN','M8','DISABLED',false)");
  r=await h.context();assert(r.catalogRows.some(x=>x.platform==='REGISTERED-PAUSED'));assert(!r.catalogRows.some(x=>['FOREIGN','DISABLED','INVISIBLE'].includes(x.platform)));
 }finally{await h.db.close();}
});
test('dependency/default/ACL and installed-object drift abort atomically without altering original functions',async()=>{
 const sql=fs.readFileSync(MIGRATION,'utf8');
 for(const drift of ["alter function public.application_session_check(uuid,uuid,text) set search_path='public'","grant execute on function public.application_auth_ip_check(text,text,uuid) to authenticated","alter function public.workorder_portal_account_context(uuid) volatile"]){const h=await fixture({install:false});try{await h.db.exec(drift);await assert.rejects(h.db.exec(sql),e=>e.message.includes('dependency_drift'));await rollbackFailed(h.db);assert.equal(await meta(h.db,signature),undefined);}finally{await h.db.close();}}
 const h=await fixture();try{await h.db.exec('grant execute on function '+signature+' to authenticated');await assert.rejects(h.db.exec(sql),e=>e.message.includes('installed_drift'));await rollbackFailed(h.db);assert((await meta(h.db,signature)).acl.includes('authenticated'));}finally{await h.db.close();}
});
