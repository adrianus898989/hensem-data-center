const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),migration=fs.readFileSync(path.join(root,'supabase/migrations/20261002094103_fee_unchanged_content_publication.sql'),'utf8');
let f,db;
before(async()=>{let setup;const filename=path.join(__dirname,'fee-effective-versions.test.cjs'),req=createRequire(filename),ctx={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(ctx);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.feeFixture={get db(){return db},input,publish,quote,rate,evidence,scalar,rollback};',ctx,{filename});await setup();f=ctx.feeFixture;db=f.db;await db.exec(migration);
 await db.exec(`create table private.fee_write_audit(table_name text,operation text);
 create function private.fee_write_audit_capture() returns trigger language plpgsql as $$begin insert into private.fee_write_audit values(TG_TABLE_NAME,TG_OP);return null;end$$;
 create trigger rates_write_audit after insert or update or delete on third_party_rates for each row execute function private.fee_write_audit_capture();
 create trigger statuses_write_audit after insert or update or delete on third_party_platform_status for each row execute function private.fee_write_audit_capture();
 create trigger evidence_write_audit after insert or update or delete on private.fee_rate_current_evidence for each row execute function private.fee_write_audit_capture();`);
});
after(()=>db?.close());
const scalar=(q,args)=>f.scalar(q,args),rollback=fn=>f.rollback(fn),publish=x=>f.publish(x),input=(...args)=>f.input(...args);
const snapshot=()=>scalar("select jsonb_build_object('rates',(select jsonb_agg(to_jsonb(r) order by id) from third_party_rates r),'statuses',(select jsonb_agg(to_jsonb(r) order by id) from third_party_platform_status r),'evidence',(select jsonb_agg(to_jsonb(e) order by source_id,direction) from private.fee_rate_current_evidence e))");
const writes=()=>scalar('select count(*)::int from private.fee_write_audit');
const clearWrites=()=>db.exec('delete from private.fee_write_audit');
test('unchanged complete observations write zero projection/evidence rows and retain old pricing generation',async()=>rollback(async()=>{
 const first=input();assert.equal((await publish(first)).unchanged,false);const before=await snapshot();await clearWrites();
 const next=input();next.rates[0].updated_at=next.at;next.rates[0].created_at=next.at;next.status[0].updated_at=next.at;next.ev[0].observedAt=next.at;next.manifest.observed_at=next.at;
 const r=await publish(next);assert.equal(r.unchanged,true);assert.equal(r.generationId,next.id);assert.equal(r.feeVersions.inserted,0);assert.equal(await writes(),0);assert.deepEqual(await snapshot(),before);
 assert.equal(await scalar('select count(*)::int from private.fee_rate_generations'),2);assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),2);assert.equal(await scalar('select generation_id::text from private.fee_rate_head'),next.id);
 assert.equal(await scalar('select bool_and(generation_id=$1) from private.fee_rate_current_evidence',[first.id]),true);assert.equal((await f.quote()).fee_version_state,'complete');
 const count=await scalar('select count(*)::int from private.fee_rate_generations');assert.deepEqual(await publish(next),r);assert.equal(await scalar('select count(*)::int from private.fee_rate_generations'),count,'same generation retry remains exact-idempotent');
}));
test('stable identity row reorder skips writes but every rate/status/effective/source metadata semantic change forces full publication',async()=>rollback(async()=>{
 const rates=[f.rate(),f.rate({id:'second',third_party:'OtherPay'})],ev=[f.evidence(),f.evidence({id:'second'})];const first=input(rates,ev);first.status.push({...first.status[0],id:'status2',platform:'Second'});await publish(first);await clearWrites();
 const reordered=input([...rates].reverse(),[...ev].reverse());reordered.status=[...first.status].reverse();assert.equal((await publish(reordered)).unchanged,true);assert.equal(await writes(),0);
 const changes=[x=>x.rates[0].collect_fee='4%',x=>x.rates[0].collect_single_fee='8',x=>x.rates[0].channel_info='changed',x=>x.status[0].raw_status='inactive',x=>x.status[0].platform='ChangedPlatform',x=>x.ev[0].effectiveFrom='2026-09-19T00:00:00Z',x=>x.ev[0].currency='INR',x=>x.ev[0].state='missing_effective_time',x=>x.ev[0].effectiveCell='BC2',x=>x.manifest.parser='changed-parser',x=>x.rates[0].source_row=30];
 for(const change of changes){await db.exec('savepoint semantic_case');await clearWrites();const x=input(structuredClone(rates),structuredClone(ev));x.status=structuredClone(first.status);change(x);assert.equal((await publish(x)).unchanged,false);assert.ok(await writes()>0);await db.exec('rollback to semantic_case');}
}));
test('out-of-band changed, missing, added and timestamp-only projection/evidence rows force full repair',async()=>rollback(async()=>{
 await publish(input());
 for(const statement of ["update third_party_rates set collect_fee='99%'","update third_party_rates set updated_at=updated_at+interval '1 second'","update third_party_platform_status set raw_status='changed'","delete from third_party_platform_status","insert into third_party_rates(id,third_party) values('unexpected','unexpected')","update private.fee_rate_current_evidence set state='changed'","delete from private.fee_rate_current_evidence where direction='charge'"]){
  await db.exec('savepoint external_case');await db.exec(statement);await clearWrites();assert.equal((await publish(input())).unchanged,false,statement);assert.ok(await writes()>0);assert.equal(await scalar('select collect_fee from third_party_rates where id=\'rate\''),'1%');assert.equal((await f.quote()).fee_version_state,'complete');await db.exec('rollback to external_case');
 }
}));
test('unchanged branch still enforces full input validation, stale captures, generation replay and source boundary',async()=>rollback(async()=>{
 const first=input();await publish(first);
 const attempts=[['incomplete',x=>x.manifest.complete=false,/invalid_fee_generation/],['duplicate',x=>x.rates.push(x.rates[0]),/invalid_fee_generation|incomplete_fee_generation/],['stale',x=>x.at=first.at,/stale_fee_generation/],['replay-conflict',x=>{x.id=first.id;x.rates[0].status='changed'},/fee_generation_replay_conflict/]];
 for(const [name,change,error]of attempts){await db.exec('savepoint denied');const x=input();change(x);await assert.rejects(publish(x),error,name);await db.exec('rollback to denied');}
 const x=input();await db.exec('savepoint wrongsource');await assert.rejects(scalar('select public.fee_rate_publish_generation($1,$2,$3,$4,$5,$6,$7)',[x.id,'other-source',x.at,JSON.stringify(x.rates),JSON.stringify(x.status),JSON.stringify(x.ev),JSON.stringify(x.manifest)]),/fee_source_identity_changed/);await db.exec('rollback to wrongsource');assert.equal(await scalar('select count(*)::int from private.fee_rate_generations'),1);
}));
test('failure after unchanged receipt insertion rolls back receipt/head and preserves valid pricing evidence',async()=>rollback(async()=>{
 await publish(input());const before=await snapshot(),head=await scalar('select to_jsonb(h) from private.fee_rate_head h');
 await db.exec(`create function private.fail_unchanged_sync() returns trigger language plpgsql as $$begin if NEW.message='完整费率检查；内容未变' then raise exception 'synthetic_unchanged_failure';end if;return NEW;end$$;create trigger fail_unchanged before insert or update on sync_status for each row execute function private.fail_unchanged_sync();savepoint failed_call`);
 await assert.rejects(publish(input()),/synthetic_unchanged_failure/);await db.exec('rollback to failed_call');assert.deepEqual(await snapshot(),before);assert.deepEqual(await scalar('select to_jsonb(h) from private.fee_rate_head h'),head);assert.equal(await scalar('select count(*)::int from private.fee_rate_generations'),1);assert.equal((await f.quote()).fee_version_state,'complete');
}));
test('changed full publication still rolls back projections, fingerprints and versions on late failure',async()=>rollback(async()=>{
 await publish(input());const before=await snapshot(),head=await scalar('select to_jsonb(h) from private.fee_rate_head h');await db.exec("alter table third_party_platform_status add constraint fastpath_full_failure check(platform<>'FAIL');savepoint failed_full");const x=input([f.rate({collect_fee:'4%'})],[f.evidence({effectiveFrom:'2026-09-19T00:00:00Z'})]);x.status[0].platform='FAIL';await assert.rejects(publish(x),/fastpath_full_failure/);await db.exec('rollback to failed_full');assert.deepEqual(await snapshot(),before);assert.deepEqual(await scalar('select to_jsonb(h) from private.fee_rate_head h'),head);assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),2);
}));
test('snapshot helper is private and fee head RLS/table ACL are unchanged',async()=>rollback(async()=>{
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.fee_rate_snapshot_hashes(text)','EXECUTE')",[role]),false);
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.fee_rate_head'::regclass"),true);for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_table_privilege($1,'private.fee_rate_head','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
 assert.equal(await scalar("select md5(prosrc) from pg_proc where oid='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure"),'1da790f7dc39d5f58d7444dc1fcff4bc');
}));
test('production-sized unchanged capture keeps zero current-row writes with exact real receipt',async()=>rollback(async()=>{
 const rates=Array.from({length:512},(_,i)=>f.rate({id:'r'+i,third_party:'Synthetic'+i,source_row:i+2})),ev=rates.map(r=>f.evidence({id:r.id}));const x=input(rates,ev);x.status=Array.from({length:4766},(_,i)=>({...x.status[0],id:'s'+i,platform:'Platform'+i%18}));await publish(x);await clearWrites();const next=input(rates,ev);next.status=x.status;const t=performance.now();const r=await publish(next);console.log('synthetic unchanged 512/4766 milliseconds:',Math.round(performance.now()-t));assert.equal(r.unchanged,true);assert.equal(r.rates,512);assert.equal(r.platformStatuses,4766);assert.equal(await writes(),0);assert.equal(await scalar('select count(*)::int from private.fee_rate_generations'),2);
}));
test('pre-upgrade head without fingerprints performs one full publication before skipping',async()=>rollback(async()=>{
 await publish(input());await db.exec('update private.fee_rate_head set semantic_hash=null,projection_hash=null,evidence_hash=null');await clearWrites();assert.equal((await publish(input())).unchanged,false);assert.ok(await writes()>0);await clearWrites();assert.equal((await publish(input())).unchanged,true);assert.equal(await writes(),0);
}));
test('fast-path function guard preserves all metadata and rejects body, ACL or execution-setting drift',async()=>rollback(async()=>{
 const initial=fs.readFileSync(path.join(root,'supabase/migrations/20261002080803_immutable_fee_effective_versions.sql'),'utf8');const start=initial.indexOf('create function public.fee_rate_publish_generation('),end=initial.indexOf('end $function$;',start)+'end $function$;'.length;
 const original=initial.slice(start,end).replace('create function','create or replace function').replace('delete from private.fee_rate_current_evidence;','delete from private.fee_rate_current_evidence c where exists (select 1 from private.fee_rate_generations g where g.id=c.generation_id and g.source_key=p_source_key);');
 const signature='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)',metadata=()=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid=$1::regprocedure",[signature]);
 const patch=migration.match(/do \$fee_unchanged_publication\$[\s\S]*?end \$fee_unchanged_publication\$;/)[0];await db.exec(original);const before=await metadata();await db.exec('savepoint original_fast');await db.exec(patch);assert.deepEqual(await metadata(),before);await db.exec('rollback to original_fast');
 for(const change of ["grant execute on function "+signature+" to authenticated","alter function "+signature+" set work_mem='8MB'"]){await db.exec('savepoint badmeta');await db.exec(change);await assert.rejects(db.exec(patch),/fee_unchanged_metadata_drift/);await db.exec('rollback to badmeta');}
 await db.exec(original.replace('begin\n if p_generation_id','begin\n -- drift\n if p_generation_id'));await db.exec('savepoint badbody');await assert.rejects(db.exec(patch),/fee_unchanged_baseline_drift/);await db.exec('rollback to badbody');
}));
