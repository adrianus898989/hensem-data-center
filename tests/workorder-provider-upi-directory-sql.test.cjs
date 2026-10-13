const test=require('node:test');const assert=require('node:assert/strict');const{fixture,IDS}=require('./fixtures/workorder-provider-upi-fixture.cjs');
const req=(action,extra={})=>({action,platform:'PLATFORM-A',provider:'Pay-A',...extra});
test('current configured catalog and fresh employee scopes preserve country/team identity',async()=>{const h=await fixture();try{
 assert.deepEqual((await h.call(IDS.agent,{action:'catalog',platform:'PLATFORM-A'})).providers,['Pay-A','Pay-B']);
 await assert.rejects(()=>h.call(IDS.agent,{action:'catalog',platform:'PLATFORM-B'}),/scope_denied/);
 await assert.rejects(()=>h.call(IDS.admin,{action:'catalog',platform:'PLATFORM-A'}),/account_denied/);
 await assert.rejects(()=>h.call(IDS.agent,req('lookup',{provider:'Pay-Foreign',upiId:'synthetic@bank'})),/invalid_provider/);
 await h.db.exec("update public.workorder_portal_accounts set active=false where role='agent' and team='M8'");await assert.rejects(()=>h.call(IDS.agent,req('list')),/account_denied/);
 assert.deepEqual((await h.call(IDS.owner,{action:'catalog',platform:'PLATFORM-B'})).providers,['Pay-A','Pay-Hidden']);
 }finally{await h.db.close();}});
test('add/read/lookup preserve submitted spelling and audit once with normalized duplicate and provider mismatch',async()=>{const h=await fixture();try{
 const a=await h.call(IDS.agent,req('add',{upiId:'  Synthetic.Test@Bank  '}));assert.equal(a.row.upiId,'Synthetic.Test@Bank');assert.equal(a.row.createdBy,IDS.agent);
 assert.equal((await h.call(IDS.agent,req('add',{upiId:'synthetic.test@bank'}))).code,'upi_duplicate');
 assert.equal((await h.call(IDS.supervisor,req('lookup',{upiId:'SYNTHETIC.TEST@BANK'}))).status,'matched');
 const mismatch=await h.call(IDS.agent,req('lookup',{provider:'Pay-B',upiId:'synthetic.test@bank'}));assert.equal(mismatch.status,'other_provider');assert.deepEqual(mismatch.matchedProviders,['Pay-A']);
 assert.equal((await h.call(IDS.agent,req('add',{provider:'Pay-B',upiId:'synthetic.test@bank'}))).code,'upi_provider_mismatch');
 assert.equal((await h.call(IDS.auditor,req('list'))).canAdd,false);await assert.rejects(()=>h.call(IDS.auditor,req('add',{upiId:'another@bank'})),/readonly_account/);
 assert.equal((await h.db.query('select count(*)::int n from private.workorder_provider_upi_audit')).rows[0].n,1);
 }finally{await h.db.close();}});
test('hidden provider records do not disclose existence, veto unrelated adds or enter another scope',async()=>{const h=await fixture();try{
 await h.call(IDS.other,{action:'add',platform:'PLATFORM-B',provider:'Pay-Hidden',upiId:'hidden@bank'});
 const r=await h.call(IDS.agent,req('lookup',{upiId:'hidden@bank'}));assert.equal(r.status,'not_recorded');assert.deepEqual(r.matchedProviders,[]);
 assert.equal((await h.call(IDS.agent,req('add',{upiId:'hidden@bank'}))).ok,true);
 await assert.rejects(()=>h.call(IDS.agent,req('list',{provider:'Pay-Hidden'})),/invalid_provider/);
 }finally{await h.db.close();}});
test('invalid/masked values and unexpected actor/scope fields are rejected without touching workorder input',async()=>{const h=await fixture();try{
 await h.db.exec("insert into public.admin_deposit_followup_rows values('EMPLOYEE-INPUT-UNCHANGED')");
 for(const upiId of ['', '-', '***@bank','test @bank','https://test@bank','a@b','a@bank\n','synthetic@银行'])await assert.rejects(()=>h.call(IDS.agent,req('add',{upiId})),/invalid_upi|invalid_request/);
 await assert.rejects(()=>h.call(IDS.agent,req('add',{upiId:'x@bank',actor:IDS.owner})),/invalid_request/);
 await assert.rejects(()=>h.call(IDS.agent,req('list',{limit:101})),/invalid_pagination/);
 assert.equal((await h.db.query('select id from public.admin_deposit_followup_rows')).rows[0].id,'EMPLOYEE-INPUT-UNCHANGED');
 }finally{await h.db.close();}});
test('service-only invoker RPC/private RLS grants do not authorize direct browser reads or mutation',async()=>{const h=await fixture();try{
 for(const role of ['anon','authenticated']){await h.db.exec('set role '+role);await assert.rejects(()=>h.db.query('select public.workorder_provider_upi($1,$2)',[IDS.owner,JSON.stringify(req('list'))]));await assert.rejects(()=>h.db.exec('select * from private.workorder_provider_upis'));await h.db.exec('reset role');}
 const f=(await h.db.query("select prosecdef,proconfig from pg_proc where oid='public.workorder_provider_upi(uuid,jsonb)'::regprocedure")).rows[0];assert.equal(f.prosecdef,false);assert.deepEqual(f.proconfig,['search_path=""']);
 await h.db.exec('set role service_role');await assert.rejects(()=>h.db.exec('delete from private.workorder_provider_upis'));await assert.rejects(()=>h.db.exec('update private.workorder_provider_upis set provider=\'x\''));await h.db.exec('reset role');
 }finally{await h.db.close();}});
test('directory and audit insertion are one transaction and audit failure cannot leave a successful unaudited add',async()=>{const h=await fixture();try{
 await h.db.exec('revoke insert on private.workorder_provider_upi_audit from service_role');
 await assert.rejects(()=>h.call(IDS.agent,req('add',{upiId:'rollback@bank'})),/permission denied/);
 assert.equal((await h.db.query('select count(*)::int n from private.workorder_provider_upis')).rows[0].n,0);
 assert.equal((await h.db.query('select count(*)::int n from private.workorder_provider_upi_audit')).rows[0].n,0);
 }finally{await h.db.close();}});

const fs=require('node:fs');const path=require('node:path');const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261013073235_workorder_provider_upi_directory.sql'),'utf8');
test('actual guarded migration installs empty objects, preserves source/RPC metadata and replays with directory/audit rows intact',async()=>{const h=await fixture({install:false});try{
 const old=(await h.db.query("select oid,md5(prosrc)hash,proacl::text acl,proconfig from pg_proc where oid in('public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure,'public.workorder_followup_mirror(jsonb)'::regprocedure)order by oid")).rows;
 await h.db.exec(migration);await h.call(IDS.agent,{action:'add',platform:'PLATFORM-A',provider:'Pay-A',upiId:'synthetic@bank'});
 const snapshot=(await h.db.query('select (select jsonb_agg(to_jsonb(d))from private.workorder_provider_upis d) data,(select jsonb_agg(to_jsonb(a))from private.workorder_provider_upi_audit a)audit')).rows;
 await h.db.exec(migration);assert.deepEqual((await h.db.query('select (select jsonb_agg(to_jsonb(d))from private.workorder_provider_upis d) data,(select jsonb_agg(to_jsonb(a))from private.workorder_provider_upi_audit a)audit')).rows,snapshot);
 assert.deepEqual((await h.db.query("select oid,md5(prosrc)hash,proacl::text acl,proconfig from pg_proc where oid in('public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure,'public.workorder_followup_mirror(jsonb)'::regprocedure)order by oid")).rows,old);
 }finally{await h.db.close();}});
test('owner, preexisting RPC/source drift, partial install, private metadata and body drift reject atomically',async()=>{
 for(const statement of ["alter table private.workorder_provider_upis disable row level security","grant select on private.workorder_provider_upis to authenticated","alter function public.workorder_provider_upi(uuid,jsonb)security definer","alter table private.workorder_provider_upis add column extra text"]){const h=await fixture();try{await h.db.exec(statement);await assert.rejects(()=>h.db.exec(migration),/upi_installed_metadata_drift/);await h.db.exec('rollback');}finally{await h.db.close();}}
 const h=await fixture({install:false});try{await h.db.exec('alter table public.third_party_platform_status rename column third_party to unexpected');await assert.rejects(()=>h.db.exec(migration),/upi_source_schema_drift/);await h.db.exec('rollback');assert.equal((await h.db.query("select to_regclass('private.workorder_provider_upis') v")).rows[0].v,null);}finally{await h.db.close();}
});
