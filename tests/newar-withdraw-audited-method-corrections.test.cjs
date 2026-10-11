// Actual PostgreSQL execution with synthetic orders/actors only; no network/session impersonation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const prefix=read('tests/newar-withdraw-blocking-raw-reasons.test.cjs').split('\ntest(')[0];
const old=new Function('require','__dirname',prefix+'\nreturn{fixture,migration,call,order,projection};')(require,__dirname);
const sql=read('supabase/migrations/20261011105407_newar_withdraw_audited_method_corrections.sql');
const cutover=read('supabase/migrations/20261011064050_newar_withdraw_fact_reader_cutover.sql');
async function fixture(oracle=false){
 const db=await old.fixture();await db.exec(cutover);await db.exec(old.migration);
 const ids=[];
 for(let i=0;i<3;i++)ids.push(await old.order(db,'SyntheticConfirmed'+i,null,{operator:'SyntheticLocker',method:oracle?'auto':'manual',handled:null,raw:{operatorSourceField:'lockOperator',sourceHandledSourceField:null}}));
 await old.order(db,'remaining-missing',null,{operator:'Remaining named actor',raw:{operatorSourceField:'lockOperator'}});
 await old.order(db,'manual-reason','Synthetic manual reason',{raw:{operatorSourceField:'operator',operator:'Synthetic native operator'}});
 await old.order(db,'native-auto',null,{method:'auto',operator:'system',raw:{operatorSourceField:'operator',operator:'system'}});
 await old.order(db,'unknown',null,{method:'unknown',raw:{operatorSourceField:'lockOperator'}});
 await old.projection.coverage(db,'DhaniWin','2026-10-09T18:30:00Z','2026-10-10T18:30:00Z');
 return{db,ids};
}
async function verify(db,ids){
 await db.query(`insert into private.newar_withdraw_method_verifications(record_id,platform,dataset,source_id,confirmed_method,evidence_kind,evidence_ref)
 select id,platform,dataset,source_id,'auto','user_confirmed_source_ui','synthetic_three_order_confirmation'
 from public.newar_detail_records where id=any($1::uuid[])`,[ids]);
}
async function days(db,platform='DHANIWIN'){
 return(await db.query(`select to_jsonb(d) item from private.dashboard_admin_newar_withdraw_days($1::jsonb,'{}'::jsonb,'2026-10-10','2026-10-10') d order by data_date,platform`,[{country:'印度',platform}])).rows.map(r=>r.item);
}
async function original(db){return(await db.query('select to_jsonb(n) item from public.newar_detail_records n order by source_id')).rows.map(r=>r.item)}
async function hashes(db){return(await db.query(`select oid::regprocedure::text sig,md5(prosrc) hash from pg_proc where oid in(
 'private.newar_withdraw_fact(public.newar_detail_records)'::regprocedure,'private.sync_newar_withdraw_fact()'::regprocedure,
 'private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'::regprocedure) order by 1`)).rows}

test('schema migration contains no real order IDs or source writes and does not reclassify historical rows',async()=>{
 const {db}=await fixture();try{const source=await original(db),beforeDays=await days(db),beforeReason=await old.call(db);
 assert.doesNotMatch(sql,/WD\d|update\s+public\.newar_detail_records|insert\s+into\s+private\.newar_withdraw_method_verifications/i);
 await db.exec(sql);assert.deepEqual(await original(db),source);assert.deepEqual(await days(db),beforeDays);assert.deepEqual(await old.call(db),beforeReason);
 assert.equal((await db.query('select count(*) n from private.newar_withdraw_method_verifications')).rows[0].n,0);
 }finally{await db.close()}
});
test('three precise audited corrections yield full daily/reasons JSON identical to independently automatic source facts',async()=>{
 const actual=await fixture(),oracle=await fixture(true);try{
 const source=await original(actual.db);await actual.db.exec(sql);await oracle.db.exec(sql);await verify(actual.db,actual.ids);
 // Oracle refreshes its independent synthetic source facts through the same new projector.
 await oracle.db.query('update public.newar_detail_records set raw=raw where id=any($1::uuid[])',[oracle.ids]);
 assert.deepEqual(await original(actual.db),source);
 assert.deepEqual(await days(actual.db),await days(oracle.db));assert.deepEqual(await old.call(actual.db),await old.call(oracle.db));
 const d=(await days(actual.db))[0];assert.equal(d.total,7);assert.equal(d.auto_count,4);assert.equal(d.manual_count,2);assert.equal(d.unclassified_count,1);
 assert.equal(d.auto_count+d.manual_count+d.unclassified_count,d.total);
 const reasons=await old.call(actual.db);assert.equal(reasons.noteCount,2);assert.deepEqual(reasons.summary.operatorCounts,{total:7,system:4,manual:2,unknown:1,manualWithReason:1,manualWithoutReason:1});
 assert.equal(reasons.rows.reduce((n,r)=>n+r.count,0),2);assert.equal(reasons.rows.find(r=>r.reason==='检测没备注').count,1);
 assert.ok(d.operator_rows.every(r=>r.account!=='SyntheticLocker'));
 const f=(await actual.db.query('select method,account,submitted_at,handled_at from private.newar_withdraw_facts where record_id=any($1::uuid[])',[actual.ids])).rows;
 assert.ok(f.every(r=>r.method==='auto'&&r.account==='SyntheticLocker'&&r.submitted_at!==null&&r.handled_at===null));
 }finally{await actual.db.close();await oracle.db.close()}
});
test('stale collector retransmission preserves audited method without changing original actor provenance',async()=>{
 const {db,ids}=await fixture();try{await db.exec(sql);await verify(db,ids);const audit=(await db.query('select to_jsonb(v) item from private.newar_withdraw_method_verifications v order by record_id')).rows;
 await db.query('update public.newar_detail_records set raw=raw,status_group=\'pending\' where id=any($1::uuid[])',[ids]);
 assert.ok((await db.query('select method,account,status_group from private.newar_withdraw_facts where record_id=any($1::uuid[])',[ids])).rows.every(r=>r.method==='auto'&&r.account==='SyntheticLocker'&&r.status_group==='pending'));
 assert.deepEqual((await db.query('select to_jsonb(v) item from private.newar_withdraw_method_verifications v order by record_id')).rows,audit);
 await db.exec(sql);assert.deepEqual((await db.query('select to_jsonb(v) item from private.newar_withdraw_method_verifications v order by record_id')).rows,audit);
 }finally{await db.close()}
});
test('unknown-only and verified-zero scopes remain distinct; no zero-manual assertion manufactures all automatic',async()=>{
 const {db}=await fixture();try{await db.exec(sql);
 await old.order(db,'unknown-only',null,{platform:'MAANWIN',method:'unknown',raw:{operatorSourceField:'lockOperator'}});
 const unknown=(await days(db,'MAAN.WIN'))[0];assert.equal(unknown.total,1);assert.equal(unknown.auto_count,0);assert.equal(unknown.manual_count,0);assert.equal(unknown.unclassified_count,1);
 assert.notEqual(unknown.auto_count,unknown.total);
 const none=(await days(db,'ZERO'))[0];assert.equal(none.total,null);assert.equal(none.auto_count,null);assert.equal(none.manual_count,null);assert.equal(none.unclassified_count,null);
 await old.projection.coverage(db,'ZERO','2026-10-09T18:30:00Z','2026-10-10T18:30:00Z');const zero=(await days(db,'ZERO'))[0];assert.equal(zero.total,0);assert.equal(zero.unclassified_count,0);
 }finally{await db.close()}
});
test('exact source identity is mandatory and later dataset/platform/source-ID/UUID changes invalidate the correction',async()=>{
 for(const column of ['dataset','platform','source_id','id']){const {db,ids}=await fixture();try{await db.exec(sql);await verify(db,[ids[0]]);
 const value={dataset:'workorder',platform:'MAANWIN',source_id:'different-synthetic-order',id:'00000000-0000-4000-8000-000000000123'}[column];
 await db.query(`update public.newar_detail_records set ${column}=$1 where id=$2`,[value,ids[0]]);
 assert.equal((await db.query('select count(*) n from private.newar_withdraw_method_verifications')).rows[0].n,0);
 if(column!=='dataset')assert.equal((await db.query('select method from private.newar_withdraw_facts where record_id=$1',[column==='id'?value:ids[0]])).rows[0].method,'manual');
 else assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts where record_id=$1',[ids[0]])).rows[0].n,0);
 }finally{await db.close()}}
});
test('wrong identity, wrong table trigger and public/service verification writes fail closed',async()=>{
 const {db,ids}=await fixture();try{await db.exec(sql);
 await assert.rejects(db.query(`insert into private.newar_withdraw_method_verifications values($1,'MAANWIN','withdraw','SyntheticConfirmed0','auto','user_confirmed_source_ui','synthetic',now())`,[ids[0]]),/source_identity_mismatch/);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);
 await assert.rejects(db.query('select * from private.newar_withdraw_method_verifications'),/permission denied/);
 await assert.rejects(db.query(`insert into private.newar_withdraw_method_verifications values($1,'DhaniWin','withdraw','SyntheticConfirmed0','auto','user_confirmed_source_ui','synthetic',now())`,[ids[0]]),/permission denied/);await db.exec('reset role')}
 await db.exec(`create table public.wrong_verification_trigger(record_id uuid);create trigger wrong_context after insert on public.wrong_verification_trigger for each row execute function private.sync_newar_withdraw_method_verification()`);
 await assert.rejects(db.query('insert into public.wrong_verification_trigger values($1)',[ids[0]]),/trigger_context_invalid/);
 await verify(db,[ids[0]]);await db.exec('set role service_role');await db.query('update public.newar_detail_records set raw=raw where id=$1',[ids[0]]);await db.exec('reset role');
 assert.equal((await db.query('select method from private.newar_withdraw_facts where record_id=$1',[ids[0]])).rows[0].method,'auto');
 await db.exec('set role authenticated');const allowed=await old.call(db);assert.equal(allowed.noteCount,4);
 await db.exec(`set test.scope='{"denied":true}'`);await assert.rejects(old.call(db),/scope_denied/);await db.exec('reset role');
 }finally{await db.close()}
});
test('submitted and handled timestamps remain independent while duration guards remain unchanged',async()=>{
 const {db}=await fixture();try{await db.exec(sql);
 const id=await old.order(db,'handled-only',null,{raw:{sourceSubmittedAt:null,sourceSubmittedSourceField:null,sourceHandledAt:'2026-10-10T00:01:00Z',sourceHandledSourceField:'handledTime'}});
 const row=(await db.query('select submitted_at,handled_at from private.newar_withdraw_facts where record_id=$1',[id])).rows[0];assert.equal(row.submitted_at,null);assert.ok(row.handled_at instanceof Date);
 const d=(await days(db))[0];assert.equal(d.duration_sample_count,4); // Existing four paired source facts only.
 }finally{await db.close()}
});
test('function/ACL metadata drift is rejected and replay preserves reader hashes',async()=>{
 const {db}=await fixture();try{await db.exec(sql);const before=await hashes(db);await db.exec(sql);assert.deepEqual(await hashes(db),before);
 await db.exec('grant select on private.newar_withdraw_method_verifications to authenticated');await assert.rejects(db.exec(sql),/table_drift/);await db.exec('rollback');
 await db.exec('revoke select on private.newar_withdraw_method_verifications from authenticated');await db.exec('alter function private.sync_newar_withdraw_method_verification() reset search_path');
 await assert.rejects(db.exec(sql),/function_drift/);await db.exec('rollback');
 }finally{await db.close()}
});
test('CHECK and function-volatility drift fail closed rather than being repaired on replay',async()=>{
 for(const kind of ['check','volatility']){const {db}=await fixture();try{await db.exec(sql);
 if(kind==='check')await db.exec('alter table private.newar_withdraw_method_verifications drop constraint newar_method_verification_method_check;alter table private.newar_withdraw_method_verifications add constraint newar_method_verification_method_check check(true)');
 else await db.exec('alter function private.newar_withdraw_fact(public.newar_detail_records) immutable');
 await assert.rejects(db.exec(sql),kind==='check'?/checks_drift/:/function_metadata_drift/);await db.exec('rollback');
 }finally{await db.close()}}
});
test('parameterized three-order maintenance checks stale source, preserves raw data and replays after old-client uploads',async()=>{
 const template=read('supabase/maintenance/newar_withdraw_method_correction_template.sql');
 const {db,ids}=await fixture();try{await db.exec(sql);
 await db.exec(`begin;create temp table newar_method_correction_targets(record_id uuid,platform text,dataset text,source_id text,expected_source_hash text,expected_old_method text,evidence_ref text) on commit drop`);
 await db.query(`insert into pg_temp.newar_method_correction_targets select id,platform,dataset,source_id,md5(to_jsonb(n)::text),'manual','synthetic_three_order_confirmation' from public.newar_detail_records n where id=any($1::uuid[])`,[ids]);
 await db.exec(template);await db.exec('commit');assert.ok((await db.query('select method from private.newar_withdraw_facts where record_id=any($1::uuid[])',[ids])).rows.every(r=>r.method==='auto'));
 await db.query('update public.newar_detail_records set raw=raw,received_at=received_at+interval \'1 second\' where id=any($1::uuid[])',[ids]);
 await db.exec(`begin;create temp table newar_method_correction_targets(record_id uuid,platform text,dataset text,source_id text,expected_source_hash text,expected_old_method text,evidence_ref text) on commit drop`);
 await db.query(`insert into pg_temp.newar_method_correction_targets select id,platform,dataset,source_id,'00000000000000000000000000000000','manual','synthetic_three_order_confirmation' from public.newar_detail_records n where id=any($1::uuid[])`,[ids]);
 await db.exec(template);await db.exec('commit');
 await db.exec('delete from private.newar_withdraw_method_verifications');
 await db.exec(`begin;create temp table newar_method_correction_targets(record_id uuid,platform text,dataset text,source_id text,expected_source_hash text,expected_old_method text,evidence_ref text) on commit drop`);
 await db.query(`insert into pg_temp.newar_method_correction_targets select id,platform,dataset,source_id,'00000000000000000000000000000000','manual','synthetic_three_order_confirmation' from public.newar_detail_records n where id=any($1::uuid[])`,[ids]);
 await assert.rejects(db.exec(template),/stale_source/);await db.exec('rollback');
 }finally{await db.close()}
});
