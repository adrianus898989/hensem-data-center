'use strict';
// Real SQL, production function/schema code, synthetic credentials/data only.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const baseline=read('fixtures/collector-identity-baseline-functions.sql');
const definitions=[...baseline.matchAll(/CREATE OR REPLACE FUNCTION ([\s\S]*?)\$function\$\s*;/g)].map(m=>m[0]);
const ddl=read('fixtures/collector-identity-baseline-schema.sql');
const migration=read('../supabase/migrations/20261001154904_collector_exact_identity_receipts.sql');
const kinds=['ar_business_direct','collection_success','workorder_issue','newar_detail','newar_business'];
const hashes=Object.fromEntries(kinds.map((k,i)=>[k,String(i+1).repeat(64)]));
const targets=['public.publish_ar_collected_orders(text,jsonb)','public.publish_collection_success_snapshot(text,jsonb)','public.publish_workorder_issue_snapshot(text,jsonb)','private.ingest_newar_detail_batch(text,jsonb)','private.ingest_newar_business_batch(text,jsonb)'];
const past=Date.now()-3600000,at=n=>new Date(past+n*1000).toISOString();
const date=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
const arScope=(platform='91CLUB',country_code='IN')=>({country_code,platform});
const snapshotScope=(platform='91CLUB',country_code='IN',timezone='Asia/Kolkata')=>({country_code,platform,timezone});
const detailScope=(platform='POPZAR',dataset='workorder')=>({platform,dataset});
const businessScope=(platform='POPZAR',kind='auto_withdraw_bundle')=>({platform,kind});
let db,control,metadata;
const meta=async d=>(await d.query(`select n.nspname,p.proname,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef,proconfig,provolatile
 from pg_proc p join pg_namespace n on n.oid=pronamespace where p.oid=any($1::regprocedure[]) order by 1,2`,[targets])).rows;
const route=async(kind,scope,hash=hashes[kind])=>(await db.query('select private.collector_resolve_exact_route_v1($1,$2,$3::jsonb) r',[kind,hash,JSON.stringify(scope)])).rows[0].r;
const recordRoute=async(kind,scope,receiptKind='ar_order',id=randomUUID())=>{
 await db.query('select private.collector_record_receipt_route_v1($1,$2,$3::jsonb,$4,$5::uuid)',[kind,hashes[kind],JSON.stringify(scope),receiptKind,id]);
 return (await db.query('select * from private.collector_receipt_routes where receipt_kind=$1 and receipt_id=$2',[receiptKind,id])).rows[0];
};
async function setup(){
 const d=new PGlite();await d.exec(`create schema private;create schema extensions;create role anon;create role authenticated;create role service_role bypassrls;
 grant usage on schema private,extensions to service_role;
 create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as $$select sha256(convert_to(v,'UTF8'))$$;`);
 const constraint=definitions.find(x=>x.startsWith('CREATE OR REPLACE FUNCTION public.workorder_issue_scopes_are_allowed('));
 await d.exec(constraint);await d.exec(ddl);await d.exec(baseline);
 // Fixture starts with the exact service-only RPC ACL contract.
 for(const f of targets)await d.exec(`revoke all on function ${f} from public,anon,authenticated;grant execute on function ${f} to service_role;`);
 await d.exec(`grant select,insert,update,delete on all tables in schema public to service_role;
 insert into public.ar_config_targets(country_code,platform,country_name,timezone) values
 ('IN','91CLUB','印度','Asia/Kolkata'),('PK','91CLUB','巴基斯坦','Asia/Karachi'),('IN','55CLUB','印度','Asia/Kolkata');
 insert into public.newar_detail_platforms(platform,country_code,country,timezone,currency) values
 ('POPZAR','PK','巴基斯坦','Asia/Karachi','PKR'),('92BLAZE','PK','巴基斯坦','Asia/Karachi','PKR'),('DhaniWin','IN','印度','Asia/Kolkata','INR');
 insert into public.dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform) values
 ('M8','AR','AR','印度','IN','印度','91CLUB','91CLUB'),('Other','AR','AR','巴基斯坦','PK','巴基斯坦','91CLUB','91CLUB'),
 ('M8','AR','AR','印度','IN','印度','55CLUB','55CLUB'),('Other','AR','AR','印度','IN','IN','55CLUB','55CLUB'),
 ('M8','NEW_AR','NEW_AR','巴基斯坦','PK','巴基斯坦','POPZAR','POPZAR'),('M8','NEW_AR','NEW_AR','巴基斯坦','PK','巴基斯坦','92BLAZE','92BLAZE'),
 ('M8','NEW_AR','NEW_AR','印度','IN','印度','DHANIWIN','DHANIWIN');`);
 await d.query("insert into ar_business_direct_credentials(token_hash,allowed_scopes,expires_at) values($1,$2::jsonb,now()+interval '1 day')",[hashes.ar_business_direct,JSON.stringify([arScope(),arScope('91CLUB','PK'),arScope('55CLUB'),arScope('Shree.Win')].map(s=>({...s,country:'display only'})))]);
 await d.query("insert into collection_success_credentials(token_hash,source_system,allowed_scopes,allowed_source_systems,expires_at) values($1,'RECHARGE_REVIEW',$2::jsonb,array['RECHARGE_REVIEW','WITHDRAW_REVIEW'],now()+interval '1 day')",[hashes.collection_success,JSON.stringify([snapshotScope(),snapshotScope('POPZAR','PK','Asia/Karachi'),snapshotScope('DhaniWin')])]);
 await d.query("insert into workorder_issue_credentials(token_hash,source_system,allowed_scopes,expires_at) values($1,'AR_WORKORDER',$2::jsonb,now()+interval '1 day')",[hashes.workorder_issue,JSON.stringify([snapshotScope('POPZAR','PK','Asia/Karachi'),snapshotScope('DhaniWin')])]);
 await d.query("insert into private.newar_detail_credentials(token_hash,allowed_scopes,expires_at) values($1,$2::jsonb,now()+interval '1 day')",[hashes.newar_detail,JSON.stringify([detailScope(),detailScope('DhaniWin')])]);
 await d.query("insert into private.newar_business_credentials(token_hash,allowed_scopes,expires_at) values($1,$2::jsonb,now()+interval '1 day')",[hashes.newar_business,JSON.stringify([businessScope(),businessScope('DhaniWin')])]);
 return d;
}
before(async()=>{db=await setup();control=await setup();metadata=await meta(db);await db.exec(migration);});
after(async()=>{await db?.close();await control?.close();});
beforeEach(async()=>{await db.exec('begin');await control.exec('begin');});
afterEach(async()=>{await db.exec('rollback');await control.exec('rollback');});

test('confirmed exact tuples bind server UUID/team/country without using display fields or country fallback',async()=>{
 const a=await route('ar_business_direct',arScope()),b=await route('ar_business_direct',arScope('91CLUB','PK'));
 assert.equal(a.routing_status,'resolved');assert.equal(a.team_name,'M8');assert.equal(a.country_code,'IN');assert.equal(a.timezone,'Asia/Kolkata');assert.equal(a.currency,null);
 assert.equal(b.team_name,'Other');assert.equal(b.country_code,'PK');assert.notEqual(a.platform_id,b.platform_id);
 assert.match(a.platform_id,/^[a-f0-9-]{36}$/);assert.match(a.source_instance_id,/^[a-f0-9-]{36}$/);assert(!JSON.stringify(a).includes(hashes.ar_business_direct));
 const c=await route('collection_success',snapshotScope('POPZAR','PK','Asia/Karachi'));
 assert.equal(c.source_system,'NEW_AR');assert.equal(c.currency,'PKR');assert.notEqual(c.source_instance_id,a.source_instance_id);
 assert.equal((await route('newar_detail',detailScope())).platform_id,c.platform_id);assert.equal((await route('newar_business',businessScope())).platform_id,c.platform_id);
});
test('ambiguous tuples, case-only aliases, wrong timezone and unenrolled channels remain unbound without guessed fields',async()=>{
 for(const [kind,scope] of [['ar_business_direct',arScope('55CLUB')],['ar_business_direct',arScope('Shree.Win')],['newar_detail',detailScope('DhaniWin')],['collection_success',snapshotScope('91CLUB','IN','UTC')]]){
  const r=await route(kind,scope);assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.reason_code,'binding_missing');assert.equal(r.team_name,undefined);assert.equal(r.platform_id,undefined);
 }
 assert.deepEqual(await route('ar_business_direct',arScope(),'f'.repeat(64)),{routing_status:'legacy_unbound',reason_code:'credential_channel_unenrolled'});
});
test('seed never picks one namespace when collection payload omits source backend and identical tuples exist in AR and NEWAR',async()=>{
 await control.exec(`insert into ar_config_targets(country_code,platform,country_name,timezone,currency) values('PK','POPZAR','巴基斯坦','Asia/Karachi','PKR');
 insert into dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform)
 values('Other','AR','AR','巴基斯坦','PK','巴基斯坦','POPZAR','POPZAR');`);
 await control.exec(migration);
 const resolver=async(kind,scope)=>(await control.query('select private.collector_resolve_exact_route_v1($1,$2,$3::jsonb) r',[kind,hashes[kind],JSON.stringify(scope)])).rows[0].r;
 const r=await resolver('collection_success',snapshotScope('POPZAR','PK','Asia/Karachi'));assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.reason_code,'binding_missing');assert.equal(r.team_name,undefined);
 const detail=await resolver('newar_detail',detailScope());assert.equal(detail.source_system,'NEW_AR');assert.equal(detail.team_name,'M8');
});
test('invalid duplicate team metadata is still a conflict, not filtered into an apparently unique seed',async()=>{
 await control.exec(`insert into dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform)
 values('','AR','AR','印度','IN','IN','91CLUB','91CLUB');`);await control.exec(migration);
 const r=(await control.query('select private.collector_resolve_exact_route_v1($1,$2,$3::jsonb) r',['ar_business_direct',hashes.ar_business_direct,JSON.stringify(arScope())])).rows[0].r;assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.reason_code,'binding_missing');
});
test('seed excludes revoked and expired credential channels',async()=>{
 await control.query('update private.newar_detail_credentials set revoked=true where token_hash=$1',[hashes.newar_detail]);await control.query("update private.newar_business_credentials set expires_at=now()-interval '1 second' where token_hash=$1",[hashes.newar_business]);await control.exec(migration);
 const result=(await control.query('select credential_kind from private.collector_source_instances order by 1')).rows.map(r=>r.credential_kind);assert.deepEqual(result,['ar_business_direct','collection_success','workorder_issue']);
});
test('later registry team/country/source/name changes invalidate bindings rather than reassign historic platform IDs',async()=>{
 const old=await route('ar_business_direct',arScope());
 for(const update of ["team_name='Other'","country_code='PK'","source_system='NEW_AR'","source_platform='RENAMED'","active=false","source_country='IN'"]){
  await db.exec('savepoint edit');await db.exec(`update dashboard_platform_team_map set ${update} where source_system='AR' and country_code='IN' and source_platform='91CLUB'`);
  const r=await route('ar_business_direct',arScope());assert.equal(r.routing_status,'legacy_unbound',update);assert.equal(r.reason_code,'mapping_changed');assert.equal(r.platform_id,undefined);assert.equal(r.team_name,undefined);
  await db.exec('rollback to edit;release savepoint edit');
 }
 assert.equal((await route('ar_business_direct',arScope())).platform_id,old.platform_id);
 await db.exec("delete from dashboard_platform_team_map where source_system='AR' and country_code='IN' and source_platform='91CLUB'");
 assert.equal((await route('ar_business_direct',arScope())).reason_code,'mapping_changed');
});
test('a new conflicting exact tuple is detected after enrollment, without scanning other teams',async()=>{
 await db.exec(`insert into dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform)
 values('Other','AR','AR','印度','IN','IN','91CLUB','91CLUB')`);
 const r=await route('ar_business_direct',arScope());assert.equal(r.reason_code,'mapping_ambiguous');assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.platform_id,undefined);
 const index=(await db.query("select pg_get_indexdef('dashboard_platform_exact_collector_tuple_idx'::regclass) definition")).rows[0].definition;
 assert.match(index,/source_system, country_code, source_platform/);assert.match(index,/WHERE active/);
});
test('native timezone, currency or enabled/source changes invalidate resolved metadata',async()=>{
 for(const statement of ["update ar_config_targets set timezone='UTC' where country_code='IN' and platform='91CLUB'","update ar_config_targets set currency='INR' where country_code='IN' and platform='91CLUB'","update ar_config_targets set source_system='NEW_AR' where country_code='IN' and platform='91CLUB'"]){
  await db.exec('savepoint edit');await db.exec(statement);assert.equal((await route('ar_business_direct',arScope())).reason_code,'native_registry_changed');await db.exec('rollback to edit;release savepoint edit');
 }
 await db.exec("update newar_detail_platforms set enabled=false where platform='POPZAR'");assert.equal((await route('newar_detail',detailScope())).reason_code,'native_registry_changed');
});

const arPayload=(extra={})=>({action:'ingest',source_system:'AR',batch_id:randomUUID(),country_code:'IN',platform:'91CLUB',order_kind:'withdraw',observed_at:at(0),orders:[{order_no:'SYNTHETIC-AR',member_id:'SYNTHETIC',amount:'100.00',amount_text:'100.00',status:'success',applied_at:'2026-09-26 10:00:00',completed_at:'2026-09-26 10:01:00',operator:null,raw_channel:null,channel_type:null,remark:null,manual_remark:null}],...extra});
const csPayload=(extra={})=>({schema_version:1,source_system:'RECHARGE_REVIEW',country_code:'IN',platform:'91CLUB',stat_date:date,timezone:'Asia/Kolkata',snapshot_id:randomUUID(),snapshot_at:at(0),coverage:{complete:true,expected_count:1,fetched_count:1,unique_count:1},totals:{submitted_count:1,success_count:1},groups:[{raw_channel:'SyntheticPay',channel_type:'QR',submitted_count:1,success_count:1}],...extra});
const woPayload=(extra={})=>({schema_version:1,source_system:'AR_WORKORDER',country_code:'PK',country:'巴基斯坦',platform:'POPZAR',stat_date:date,timezone:'Asia/Karachi',snapshot_id:randomUUID(),snapshot_at:at(0),coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0,target_count:0,ignored_count:0,unmapped_count:0},totals:{submitted_count:0,submitted_amount:0,success_count:0,success_amount:0,withdraw_not_received_count:0,withdraw_not_received_amount:0,withdraw_success_count:0,withdraw_success_amount:0},groups:[],...extra});
const ndPayload=(extra={})=>({schema_version:1,batch_id:randomUUID(),platform:'POPZAR',dataset:'workorder',records:[{source_id:'SYNTHETIC-WO',order_number:'SYNTHETIC-ORIGINAL',amount:'100',currency:'PKR',status_code:'3',status_group:'pending',created_at:at(-100),captured_at:at(0),raw:{id:'SYNTHETIC-WO',depositOrderNo:'SYNTHETIC-ORIGINAL'}}],...extra});
const nbPayload=(extra={})=>({action:'ingest',kind:'auto_withdraw_bundle',batch_id:randomUUID(),platform:'POPZAR',captured_at:at(0),payload:{rows:[{stat_date:date,system_name:'AR',country:'巴基斯坦',country_code:'PK',platform:'POPZAR',total_count:1,success_count:1,reject_count:0,auto_count:1,manual_count:0,total_handle_seconds:1,handle_count:1}],operator_rows:[]},...extra});
const pipelines=[['ar_business_direct','ar_order',targets[0],arPayload,'ar_collected_order_receipts','batch_id','ar_collected_orders'],['collection_success','collection_success',targets[1],csPayload,'collection_success_snapshot_receipts','snapshot_id','collection_success_daily'],['workorder_issue','workorder_issue',targets[2],woPayload,'workorder_issue_snapshot_receipts','snapshot_id','workorder_issue_snapshot_heads'],['newar_detail','newar_detail',targets[3],ndPayload,'private.newar_detail_batches','batch_id','newar_detail_records'],['newar_business','newar_business',targets[4],nbPayload,'private.newar_business_batches','batch_id','newar_business_snapshots']];
const call=async(d,f,kind,payload,hash=hashes[kind])=>(await d.query(`select ${f.split('(')[0]}($1,$2::jsonb) ack`,[hash,JSON.stringify(payload)])).rows[0].ack;
const rejected=async(d,fn,pattern)=>{await d.exec('savepoint rejection');try{await assert.rejects(fn,pattern);}finally{await d.exec('rollback to rejection;release savepoint rejection');}};
const originalRows=async(d,table)=>(await d.query(`select to_jsonb(r)-array['id','received_at','updated_at'] row from ${table} r order by (to_jsonb(r)-array['id','received_at','updated_at'])::text`)).rows;
for(const [kind,receiptKind,f,make,table,idKey,storedTable] of pipelines){
 test(`${kind}: original accepted/replay ACK, payload fingerprint and receipt are unchanged; exactly one safe route`,async()=>{
  const p=make(),oldAck=await call(control,f,kind,p),ack=await call(db,f,kind,p);assert.deepEqual(ack,oldAck);
  assert.deepEqual(await call(db,f,kind,p),await call(control,f,kind,p));
  const fingerprint=async d=>(await d.query(`select payload_hash from ${table} where ${idKey}=$1`,[p[idKey]])).rows[0];assert.deepEqual(await fingerprint(db),await fingerprint(control));
  assert.deepEqual(await originalRows(db,storedTable),await originalRows(control,storedTable));
  const r=(await db.query('select * from private.collector_receipt_routes where receipt_kind=$1 and receipt_id=$2',[receiptKind,p[idKey]])).rows;
  assert.equal(r.length,1);assert.equal(r[0].routing_status,'resolved');assert.equal(r[0].team_name,'M8');assert(!JSON.stringify(r[0]).includes(hashes[kind]));assert(!JSON.stringify(r[0]).includes('SYNTHETIC-'));
  assert.deepEqual(await meta(db),metadata);
 });
 test(`${kind}: bad credentials, malformed payload and same-ID conflict retain original rejection`,async()=>{
  const p=make();await rejected(db,()=>call(db,f,kind,p,'f'.repeat(64)),/AUTH_INVALID/);await rejected(db,()=>call(db,f,kind,{}),/INVALID/);
  await call(db,f,kind,p);const changed={...p,[kind==='ar_business_direct'?'observed_at':kind==='newar_business'?'captured_at':kind==='newar_detail'?'records':'snapshot_at']:kind==='newar_detail'?p.records.map(r=>({...r,amount:'250'})):at(1)};
  await rejected(db,()=>call(db,f,kind,changed),/CONFLICT/);assert.equal((await db.query('select count(*)::int n from private.collector_receipt_routes')).rows[0].n,1);
 });
 test(`${kind}: scope denial and revoked/expired credentials create neither original receipt nor sidecar`,async()=>{
  const p=make(),credentialTable=kind.startsWith('newar_')?'private.'+kind+'_credentials':kind==='ar_business_direct'?'ar_business_direct_credentials':kind+'_credentials';
  await db.exec('savepoint changed_scope');await db.query(`update ${credentialTable} set allowed_scopes=$1::jsonb where token_hash=$2`,[JSON.stringify(kind==='ar_business_direct'?[arScope('55CLUB')]:kind==='collection_success'?[snapshotScope('POPZAR','PK','Asia/Karachi')]:kind==='workorder_issue'?[snapshotScope('DhaniWin')]:kind==='newar_detail'?[detailScope('DhaniWin')]:[businessScope('DhaniWin')]),hashes[kind]]);
  await rejected(db,()=>call(db,f,kind,p),/SCOPE_DENIED/);await db.exec('rollback to changed_scope;release savepoint changed_scope');
  for(const mutation of ['revoked=true',"expires_at=now()-interval '1 second'"]){await db.exec('savepoint invalid_credential');await db.query(`update ${credentialTable} set ${mutation} where token_hash=$1`,[hashes[kind]]);await rejected(db,()=>call(db,f,kind,p),/AUTH_INVALID/);await db.exec('rollback to invalid_credential;release savepoint invalid_credential');}
  assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from private.collector_receipt_routes')).rows[0].n,0);
 });
 test(`${kind}: a new older batch retains original stale/update ordering and ACK`,async()=>{
  const p=make();await call(db,f,kind,p);await call(control,f,kind,p);
  const older={...p,[idKey]:randomUUID(),[kind==='ar_business_direct'?'observed_at':kind==='newar_business'?'captured_at':kind==='newar_detail'?'records':'snapshot_at']:kind==='newar_detail'?p.records.map(r=>({...r,amount:'250',captured_at:at(-1)})):at(-1)};
  assert.deepEqual(await call(db,f,kind,older),await call(control,f,kind,older));assert.deepEqual(await originalRows(db,storedTable),await originalRows(control,storedTable));
  assert.equal((await db.query('select count(*)::int n from private.collector_receipt_routes')).rows[0].n,2);
 });
}
test('unknown or changed routing never blocks already scope-authorized writes and keeps lineage unbound',async()=>{
 const p=arPayload({platform:'Shree.Win'});assert.deepEqual(await call(db,targets[0],'ar_business_direct',p),await call(control,targets[0],'ar_business_direct',p));
 let r=(await db.query('select * from private.collector_receipt_routes where receipt_id=$1',[p.batch_id])).rows[0];assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.reason_code,'binding_missing');assert.equal(r.team_name,null);
 await db.exec("update dashboard_platform_team_map set team_name='Changed' where source_system='AR' and country_code='IN' and source_platform='91CLUB'");const changed=arPayload({orders:[]});await call(db,targets[0],'ar_business_direct',changed);
 r=(await db.query('select * from private.collector_receipt_routes where receipt_id=$1',[changed.batch_id])).rows[0];assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.reason_code,'mapping_changed');assert.equal(r.country_code,null);
});
test('real sidecar SQL failure rolls back all original writes and receipt, never a false successful ACK',async()=>{
 await db.exec('savepoint missing_table;alter table private.collector_receipt_routes rename to unavailable_route_table');const p=arPayload();
 await assert.rejects(call(db,targets[0],'ar_business_direct',p),/collector_receipt_routes.*does not exist/);await db.exec('rollback to missing_table;release savepoint missing_table');
 assert.equal((await db.query('select count(*)::int n from ar_collected_order_receipts where batch_id=$1',[p.batch_id])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from ar_collected_orders where batch_id=$1',[p.batch_id])).rows[0].n,0);
});
test('rotated or newly provisioned credential retains authorized ACK but stays unbound until explicit enrollment',async()=>{
 const fresh='e'.repeat(64),p=arPayload();await db.query("insert into ar_business_direct_credentials(token_hash,allowed_scopes,expires_at) values($1,$2::jsonb,now()+interval '1 day')",[fresh,JSON.stringify([arScope()])]);
 assert.equal((await call(db,targets[0],'ar_business_direct',p,fresh)).status,'accepted');const r=(await db.query('select * from private.collector_receipt_routes where receipt_id=$1',[p.batch_id])).rows[0];
 assert.equal(r.routing_status,'legacy_unbound');assert.equal(r.reason_code,'credential_channel_unenrolled');assert.equal(r.source_instance_id,null);assert.equal(r.platform_id,null);
});
test('historical receipt replay stays unchanged and is not assigned invented lineage retroactively',async()=>{
 const p=arPayload();await db.exec('savepoint unhook');const original=definitions.find(x=>x.startsWith('CREATE OR REPLACE FUNCTION public.publish_ar_collected_orders('));await db.exec(original);const old=await call(db,targets[0],'ar_business_direct',p);
 const patched=(await db.query("select pg_get_functiondef('public.publish_ar_collected_orders(text,jsonb)'::regprocedure) definition")).rows[0].definition;
 // Restore hook from its already tested injection; preserve the historical receipt.
 await db.exec(patched.replace(' INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);'," PERFORM private.collector_record_receipt_route_v1('ar_business_direct',p_token_hash,jsonb_build_object('country_code',p_payload->>'country_code','platform',p_payload->>'platform'),'ar_order',bid);\n INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);"));
 assert.equal(old.status,'accepted');assert.equal((await call(db,targets[0],'ar_business_direct',p)).status,'unchanged');assert.equal((await db.query('select count(*)::int n from private.collector_receipt_routes')).rows[0].n,0);
 await db.exec('rollback to unhook;release savepoint unhook');
});
test('new private tables cannot be read directly, resolver is not callable by clients or service; existing public RPC ACL unchanged',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  for(const table of ['collector_source_instances','collector_platform_identities','collector_exact_scope_bindings','collector_receipt_routes']){
   const result=(await db.query("select has_table_privilege($1,$2,'select,insert,update,delete') allowed",[role,'private.'+table])).rows[0];assert.equal(result.allowed,false);
  }
  assert.equal((await db.query("select has_function_privilege($1,'private.collector_resolve_exact_route_v1(text,text,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege($1,'private.collector_record_receipt_route_v1(text,text,jsonb,text,uuid)','execute') allowed",[role])).rows[0].allowed,role==='service_role');
  for(const f of targets)assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,f])).rows[0].allowed,role==='service_role');
 }
 await db.exec('set local role service_role');const p=arPayload();assert.equal((await call(db,targets[0],'ar_business_direct',p)).ok,true);await db.exec('reset role');
});
test('preflight rejects source function body or ACL drift before creating private routing objects',async()=>{
 for(const alter of ["grant execute on function public.publish_ar_collected_orders(text,jsonb) to authenticated","alter function public.publish_ar_collected_orders(text,jsonb) security definer"]){
  await control.exec('savepoint drift');await control.exec(alter);await assert.rejects(control.exec(migration),/collector_identity_source_contract_drift/);
  await control.exec('rollback to drift;release savepoint drift');assert.equal((await control.query("select to_regclass('private.collector_source_instances') r")).rows[0].r,null);
 }
});
