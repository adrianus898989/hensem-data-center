// Synthetic PGlite tests only. No Supabase, HTTP, CDP or production data.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,local,here,row,metadata,stage1,columns}=require('./fixtures/ar-91club-submission-projection-harness.cjs');
const install=stage1;
const count=async db=>(await db.query('select count(*)::int n from private.ar_91club_submission_facts')).rows[0].n;
const cols=columns,keys=cols.slice(0,5).join(',');
const pop=`source_system='AR' and country_code='IN' and platform='91CLUB' and order_kind='recharge' and(applied_at>=timestamp '2026-10-10' or applied_at is null or(status='已支付' and completed_at>=timestamp '2026-10-10'))`;
const exact=cols.map(c=>c+(['amount','amount_local'].includes(c)?'::text':'')).join(',');
async function parity(db){return(await db.query(`with expected as(select ${exact} from ar_collected_orders where ${pop}),diff as((select * from expected except select ${exact} from private.ar_91club_submission_facts)union all(select ${exact} from private.ar_91club_submission_facts except select * from expected))select count(*)::int n from diff`)).rows[0].n;}
async function run(fn){const db=await fixture();try{await fn(db)}finally{await db.exec('rollback;reset role').catch(()=>{});await db.close()}}
async function backfill(db){await db.exec(`insert into private.ar_91club_submission_facts(${cols.join(',')})select ${cols.join(',')} from ar_collected_orders where ${pop} on conflict(${keys})do nothing`);}

test('stage1 is install-only, exact reentrant and preserves reader/source ACL/body/settings/data',()=>run(async db=>{
 await row(db,'SYNTHETIC-OLD');const before=await metadata(db),source=(await db.query('select jsonb_agg(to_jsonb(a)) d from ar_collected_orders a')).rows[0].d,acl=(await db.query("select relacl::text acl from pg_class where oid='ar_collected_orders'::regclass")).rows[0].acl;
 await db.exec(local(install()));assert.equal(await count(db),0);await db.exec(local(install()));assert.deepEqual(await metadata(db),before);assert.equal(before.hash,'325c95878225f211b91aed89c7abae86');assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(a)) d from ar_collected_orders a')).rows[0].d,source);assert.equal((await db.query("select relacl::text acl from pg_class where oid='ar_collected_orders'::regclass")).rows[0].acl,acl);
 assert.match(install(),/contype<>'n'/);assert.match(install(),/attnotnull/);assert.doesNotMatch(install(),/__QUAL_|__POPULATION_CHECK__/);
}));
test('population contains cohort, old-created paid completion and ALL historic NULL-time, excludes other native identities',()=>run(async db=>{
 await db.exec(local(install()));const samples=[['COHORT',{}],['PAID-OLD',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10'}],['NULL-OLD',{applied_at:null,status:null,completed_at:null}],['BEFORE',{applied_at:'2026-10-09 23:59:59.999999'}],['UNPAID-OLD',{applied_at:'2020-01-01',status:'待支付',completed_at:'2026-10-10'}],['OTHER-SOURCE',{source_system:'OTHER'}],['OTHER-COUNTRY',{country_code:'PK'}],['OTHER-PLATFORM',{platform:'OTHER'}],['WITHDRAW',{order_kind:'withdraw'}]];for(const[id,p]of samples)await row(db,'SYNTHETIC-'+id,p);assert.equal(await count(db),3);assert.equal(await parity(db),0);
}));
test('bidirectional status/date/population and PK identity changes retain exact projection with deferred FK',()=>run(async db=>{
 await db.exec(local(install()));await row(db,'SYNTHETIC-MOVING',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10'});assert.equal(await count(db),1);
 await db.exec("update ar_collected_orders set status='待支付' where order_no='SYNTHETIC-MOVING'");assert.equal(await count(db),0);
 await db.exec("update ar_collected_orders set status='已支付' where order_no='SYNTHETIC-MOVING'");assert.equal(await count(db),1);
 await db.exec("update ar_collected_orders set completed_at='2026-10-09 23:59:59.999999' where order_no='SYNTHETIC-MOVING'");assert.equal(await count(db),0);
 await db.exec("update ar_collected_orders set applied_at=null,status=null,completed_at=null where order_no='SYNTHETIC-MOVING'");assert.equal(await count(db),1);
 await db.exec("begin;update ar_collected_orders set order_no='SYNTHETIC-RENAMED' where order_no='SYNTHETIC-MOVING';commit");assert.equal(await parity(db),0);
 await db.exec("begin;update ar_collected_orders set country_code='PK' where order_no='SYNTHETIC-RENAMED';commit");assert.equal(await count(db),0);
 await db.exec("begin;update ar_collected_orders set country_code='IN',applied_at='2026-10-10',order_kind='recharge' where order_no='SYNTHETIC-RENAMED';commit");assert.equal(await parity(db),0);
 await db.exec("delete from ar_collected_orders where order_no='SYNTHETIC-RENAMED'");assert.equal(await count(db),0);
}));
test('observation/raw-only updates preserve physical fact version but numeric SCALE changes update',()=>run(async db=>{
 await db.exec(local(install()));await row(db,'SYNTHETIC-SCALE',{amount_local:'1.0'});const version=async()=>(await db.query("select xmin::text xmin,ctid::text ctid,amount_local::text money from private.ar_91club_submission_facts")).rows[0];const old=await version();assert.equal(old.money,'1.0');
 await db.exec("update ar_collected_orders set observed_at='2026-10-11T13:00:00Z',raw_payload='{\"synthetic\":\"new-observation\"}'::jsonb where order_no='SYNTHETIC-SCALE'");assert.deepEqual(await version(),old);
 await db.exec("update ar_collected_orders set amount_local='1.00' where order_no='SYNTHETIC-SCALE'");const changed=await version();assert.equal(changed.money,'1.00');assert.notEqual(changed.ctid,old.ctid);assert.equal(await parity(db),0);
 await db.exec("update ar_collected_orders set amount_local=0,amount=0,money_format_version=null,currency_local=null,money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT',member_id=null,status=null,raw_channel=null,member_level=-1,recharge_count=2147483647 where order_no='SYNTHETIC-SCALE'");assert.equal(await parity(db),0);
}));
test('all eight native money inputs and NaN/Infinity are preserved, not reparsed or rounded',()=>run(async db=>{
 await db.exec(local(install()));for(const[v,id]of [['123.456789012345678900','PRECISION'],['NaN','NAN'],['Infinity','INF'],['-Infinity','NEG-INF'],[null,'NULL'],['0','ZERO']])await row(db,'SYNTHETIC-'+id,{amount_local:v,channel_type:null,money_format_version:1,currency_local:'USD',money_issue_code:'LOCAL_AMOUNT_NOT_PROVIDED'});assert.equal(await parity(db),0);assert.equal((await db.query("select amount_local::text m from private.ar_91club_submission_facts where order_no='SYNTHETIC-PRECISION'")).rows[0].m,'123.456789012345678900');
}));
test('service source writer invokes hidden SECDEF trigger; neither service/anon/auth can read/write or invoke private facts',()=>run(async db=>{
 await db.exec(local(install()));await db.exec('set role service_role');await row(db,'SYNTHETIC-SERVICE');await db.exec('reset role');assert.equal(await count(db),1);
 for(const role of ['service_role','anon','authenticated']){await db.exec('set role '+role);for(const q of ['select * from private.ar_91club_submission_facts','delete from private.ar_91club_submission_facts','select private.sync_ar_91club_submission_fact()'])await assert.rejects(()=>db.query(q),/permission denied/);await db.exec('reset role');}assert.equal(await parity(db),0);
}));
test('backfill cannot overwrite accepted latest business fields or commit source-deleted orphan',()=>run(async db=>{
 await row(db,'SYNTHETIC-BACKFILL');await db.exec(local(install()));assert.equal(await count(db),0);await backfill(db);assert.equal(await parity(db),0);
 const stale=(await db.query('select '+cols.join(',')+' from private.ar_91club_submission_facts')).rows[0];await db.exec("update ar_collected_orders set amount_local=999,status='已支付' where order_no='SYNTHETIC-BACKFILL'");const values=cols.map(c=>stale[c]);await db.query(`insert into private.ar_91club_submission_facts(${cols.join(',')})values(${cols.map((_,i)=>'$'+(i+1)).join(',')})on conflict(${keys})do nothing`,values);assert.equal(await parity(db),0);
 await db.exec("delete from ar_collected_orders where order_no='SYNTHETIC-BACKFILL'");await db.exec('begin');await db.query(`insert into private.ar_91club_submission_facts(${cols.join(',')})values(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,values);await assert.rejects(()=>db.exec('commit'),/foreign key/);await db.exec('rollback');assert.equal(await count(db),0);
}));
test('exact replay guards reject source/reader/fact/function/trigger/index security and schema drift without changing reader',()=>run(async db=>{
 await db.exec(local(install()));for(const sql of [
 'grant select on private.ar_91club_submission_facts to authenticated',
 'alter table private.ar_91club_submission_facts alter member_id set not null',
 'alter function private.sync_ar_91club_submission_fact() set search_path=public',
 'grant execute on function private.sync_ar_91club_submission_fact() to public',
 'alter table ar_collected_orders disable trigger ar91_submission_fact_sync_update',
 'drop index private.ar91_submission_facts_paid_cover_idx;create index ar91_submission_facts_paid_cover_idx on private.ar_91club_submission_facts(completed_at)include(member_id)where status=\'其他\'',
 'alter table ar_collected_orders alter member_level type bigint',
 'alter function private.dashboard_admin_live_submission_analysis(jsonb) set jit=on'
 ]){const old=await metadata(db);await db.exec('begin;'+sql);await assert.rejects(()=>db.exec(local(install())),/DRIFT|drift/);await db.exec('rollback');assert.deepEqual(await metadata(db),old);}
}));
