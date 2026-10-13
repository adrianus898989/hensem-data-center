const test=require('node:test'),assert=require('node:assert/strict');const{fixture,IDS}=require('./fixtures/workorder-upi-role-authority-fixture.cjs');
const req=(action,extra={})=>({action,platform:'PLATFORM-A',provider:'Pay-A',...extra});
test('legacy roles retain exact UPI capability and original accounts remain unassigned',async()=>{const h=await fixture();try{
 for(const r of ['agent','supervisor','auditor']){const a=await h.access(IDS[r]);assert.equal(a.permissions['provider_upis.view'],true);assert.equal(a.permissions['provider_upis.add'],r!=='auditor');assert.equal(a.custom_role_id,null);const c=await h.call(IDS[r],{action:'catalog',platform:'PLATFORM-A'});assert.equal(c.canView,true);assert.equal(c.canAdd,r!=='auditor');}
 const c=(await h.db.query('select public.workorder_portal_account_context($1) d',[IDS.agent])).rows[0].d;assert.equal(c.auth_user_id,IDS.agent);assert.equal(c.permissions['provider_upis.add'],true);assert(!('created_by' in c));assert(!('email' in c));
 await h.db.exec("update public.workorder_portal_accounts set active=false where username='agent'");const disabled=(await h.db.query('select public.workorder_portal_account_context($1) d',[IDS.agent])).rows[0].d;assert.equal(disabled.active,false);assert(Object.values(disabled.permissions).every(v=>v===false));await h.db.exec("update public.workorder_portal_accounts set active=true where username='agent'");
 assert.equal((await h.call(IDS.owner,req('list'))).canAdd,true);
 await assert.rejects(()=>h.call(IDS.auditor,req('add',{upiId:'audit@bank'})),/permission_denied/);
 }finally{await h.db.close();}});
test('new roles default no access; deliberate assignment/read/add permissions are fresh every request',async()=>{const h=await fixture();try{
 const r=(await h.callRole(IDS.owner,{action:'create-role',name:'Synthetic Zero',base_role:'agent'})).role;
 await h.assign(r.id);assert.equal((await h.access(IDS.agent)).permissions['provider_upis.view'],false);assert.equal((await h.access(IDS.agent)).permissions['provider_upis.add'],false);assert.equal((await h.access(IDS.agent)).permissions['case.create'],true);
 await assert.rejects(()=>h.call(IDS.agent,req('lookup',{upiId:'hidden@bank'})),/permission_denied/);
 const r2=(await h.callRole(IDS.owner,{action:'update-role',id:r.id,expected_version:1,patch:{permissions:{'provider_upis.view':true}}})).role;assert.equal(r2.version,2);
 assert.equal((await h.call(IDS.agent,req('list'))).canAdd,false);await assert.rejects(()=>h.call(IDS.agent,req('add',{upiId:'no@bank'})),/permission_denied/);
 await h.callRole(IDS.owner,{action:'update-role',id:r.id,expected_version:2,patch:{permissions:{'provider_upis.view':true,'provider_upis.add':true}}});assert.equal((await h.call(IDS.agent,req('add',{upiId:'yes@bank'}))).ok,true);
 await h.callRole(IDS.owner,{action:'update-role',id:r.id,expected_version:3,patch:{active:false}});await assert.rejects(()=>h.call(IDS.agent,req('list')),/permission_denied/);
 await h.db.exec("update public.workorder_portal_accounts set display_name='Still Editable' where username='agent'");assert.equal((await h.access(IDS.agent)).custom_role_name,'Synthetic Zero');
 await h.assign(null);assert.equal((await h.call(IDS.agent,req('list'))).canAdd,true);
 }finally{await h.db.close();}});
test('base-role ceiling/account-specific reductions cannot be expanded by a role; audit and optimistic versions preserve history',async()=>{const h=await fixture();try{
 for(const permissions of [{'provider_upis.add':true},{'case.create':true}])await assert.rejects(()=>h.callRole(IDS.owner,{action:'create-role',name:'Invalid Audit',base_role:'auditor',permissions}),/invalid_role/);
 for(const actor of [IDS.agent,IDS.supervisor,IDS.auditor,IDS.admin])await assert.rejects(()=>h.callRole(actor,{action:'list-roles'}),/owner_required/);
 const r=(await h.callRole(IDS.owner,{action:'create-role',name:'Allowed',base_role:'agent',permissions:{'provider_upis.view':true,'provider_upis.add':true}})).role;
 await assert.rejects(()=>h.assign(r.id,IDS.auditor),/invalid_role/);await h.assign(r.id);
 await h.db.exec("update public.workorder_portal_accounts set permissions='{\"provider_upis.view\":true,\"provider_upis.add\":false}' where username='agent'");assert.equal((await h.call(IDS.agent,req('list'))).canAdd,false);
 await h.callRole(IDS.owner,{action:'update-role',id:r.id,expected_version:1,patch:{name:'Allowed Two'}});
 await assert.rejects(()=>h.callRole(IDS.owner,{action:'update-role',id:r.id,expected_version:1,patch:{name:'Stale'}}),/role_changed/);
 assert.equal((await h.db.query('select count(*)::int n from private.workorder_permission_role_audit')).rows[0].n,2);
 const list=await h.callRole(IDS.owner,{action:'list-roles'});assert.equal(list.permission_catalog.length,17);assert(!list.permission_catalog.find(x=>x.key==='provider_upis.add').roles.includes('auditor'));
 }finally{await h.db.close();}});
test('UPI denial precedes all existence disclosure, authorization fields cannot be supplied, no source writes',async()=>{const h=await fixture();try{
 await h.call(IDS.supervisor,req('add',{upiId:'known@bank'}));await h.db.exec("update public.workorder_portal_accounts set permissions='{}' where username='agent'");
 for(const p of ['Pay-A','Invisible'])await assert.rejects(()=>h.call(IDS.agent,req('lookup',{provider:p,upiId:'known@bank'})),/permission_denied/);
 const before=(await h.db.query('select jsonb_agg(to_jsonb(x)) data from public.admin_deposit_followup_rows x')).rows;
 assert.deepEqual((await h.db.query('select jsonb_agg(to_jsonb(x)) data from public.admin_deposit_followup_rows x')).rows,before);
 for(const role of ['authenticated','anon']){await h.db.exec('set role '+role);await assert.rejects(()=>h.db.query('select public.workorder_permission_role_admin($1,$2)',[IDS.owner,'{"action":"list-roles"}']));await assert.rejects(()=>h.db.exec('select * from private.workorder_permission_roles'));await h.db.exec('reset role');}
 assert.equal((await h.db.query("select bool_or(prosecdef) b from pg_proc where proname in('workorder_permission_role_admin','workorder_portal_effective_access')")).rows[0].b,false);
 }finally{await h.db.close();}});

const fs=require('node:fs'),path=require('node:path');const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261013125609_workorder_upi_employee_role_permissions.sql'),'utf8');
test('guarded empty install/replay retains every employee assignment and original workorder readers',async()=>{const h=await fixture({install:false});try{
 const before=(await h.db.query('select jsonb_agg(to_jsonb(a))v from public.workorder_portal_accounts a')).rows[0].v;
 await h.db.exec(migration);assert.deepEqual((await h.db.query("select jsonb_agg(to_jsonb(a)-'custom_role_id')v from public.workorder_portal_accounts a")).rows[0].v,before);
 const r=(await h.callRole(IDS.owner,{action:'create-role',name:'Synthetic Replay',base_role:'agent',permissions:{'provider_upis.view':true}})).role;await h.assign(r.id);const snap=(await h.db.query('select to_jsonb(r) v from private.workorder_permission_roles r')).rows;
 await h.db.exec(migration);assert.deepEqual((await h.db.query('select to_jsonb(r) v from private.workorder_permission_roles r')).rows,snap);
 }finally{await h.db.close();}});
test('baseline and installed ACL/RLS/body/partial drift abort atomically without replacing source functions',async()=>{
 for(const change of ["alter function private.workorder_upi_actor(uuid)security definer","grant execute on function public.workorder_provider_upi(uuid,jsonb)to anon"]){const h=await fixture({install:false});try{await h.db.exec(change);await assert.rejects(()=>h.db.exec(migration),/baseline_drift/);await h.db.exec('rollback');assert.equal((await h.db.query("select to_regclass('private.workorder_permission_roles') v")).rows[0].v,null);}finally{await h.db.close();}}
 for(const change of ["alter table private.workorder_permission_roles disable row level security","grant select on private.workorder_permission_roles to authenticated","alter function public.workorder_permission_role_admin(uuid,jsonb)security definer","alter table private.workorder_permission_roles add column extra text"]){const h=await fixture({install:false});try{await h.db.exec(migration);await h.db.exec(change);await assert.rejects(()=>h.db.exec(migration),/function_drift|relation_drift/);await h.db.exec('rollback');}finally{await h.db.close();}}
});
