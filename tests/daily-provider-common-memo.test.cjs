// Existing repository fixtures and synthetic publications only. No network.
// Compare complete responses in PostgreSQL, before JSON numbers reach JS.
const {test,before,after}=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.PROVIDER_FIXTURE_ROOT||path.resolve(__dirname,'..'),fixture=path.join(root,'tests/daily-provider-base-cache.test.cjs');
let setup,reset,close,db,h,f,oldExact,newExact,oldReader,newReader;
const sandbox={require:n=>n==='node:test'?{test:()=>{},before:fn=>setup=fn,beforeEach:fn=>reset=fn,after:fn=>close=fn}:require(n),__dirname:path.dirname(fixture),console,structuredClone,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask};
const source=fs.readFileSync(fixture,'utf8');vm.runInNewContext(source.slice(0,source.indexOf("test('cold lookup"))+';globalThis.memoFixture={getDb:()=>db,f,scalar,warm};',sandbox);h=sandbox.memoFixture;f=h.f;
const operation=fs.readFileSync(path.resolve(__dirname,'../supabase/maintenance/daily-provider-common-memo.sql'),'utf8'),undo=fs.readFileSync(path.resolve(__dirname,'../supabase/maintenance/daily-provider-common-memo.rollback.sql'),'utf8');
const block=(text,n)=>text.split('-- BEGIN '+n+'\n')[1].split('-- END '+n)[0],scalar=(s,a)=>h.scalar(s,a);
const modes=async(newer)=>{await db.exec(newer?newExact:oldExact);await db.exec(newer?newReader:oldReader);};
const state=()=>scalar("select jsonb_build_object('heads',(select jsonb_agg(to_jsonb(h)order by family_digest)from private.daily_provider_base_heads h),'artifacts',(select jsonb_agg(jsonb_build_array(id,item_digest,bytes)order by id)from private.daily_provider_base_artifacts))");
let qs;
async function exact(requests=qs,passCommon=false){
 const targets=[],mappings=[],metadata=[];
 for(const q of requests){const j=(await db.query('select *from private.daily_provider_base_jobs where target->>\'id\'=$1 order by created_at limit 1',[q.platformId])).rows[0];const selected=(await db.query("select jsonb_agg(e||jsonb_build_object('jobId',a.job_id)order by n)v from jsonb_array_elements($1::jsonb)with ordinality x(e,n)join private.prepared_aggregate_artifacts a on a.id=(e#>>'{publication,id}')::uuid",[j.daily_metadata])).rows[0].v;
 targets.push(j.target);mappings.push({first:metadata.length,count:selected.length,dependency:j.dependency,...(passCommon?{scopeCommon:typeof passCommon==='string'?passCommon:await scalar("select private.prepared_aggregate_dependency_common('IN')")}:{})});metadata.push(...selected);}
 return scalar('select private.daily_provider_base_exact_read($1,$2,$3,$4)',[{publicationVersion:2,requests},targets,mappings,metadata]);
}
before(async()=>{
 await setup();db=h.getDb();await reset();
 const last=fs.readFileSync(path.join(root,'supabase/migrations/20261017054431_prepared_last_complete_reader.sql'),'utf8');await db.exec(f.fn(last,'private.prepared_aggregate_read'));await db.exec('revoke all on function private.prepared_aggregate_read(text,jsonb)from public,anon,authenticated,service_role');
 await db.exec(`create table private.fixture_common_revision(scope text primary key,revision integer);insert into private.fixture_common_revision values('IN',1);
 create or replace function private.prepared_aggregate_dependency(p_target jsonb,p_common text)returns text language plpgsql stable as $$begin if p_common is null then return null;end if;return'current';end$$;
 create or replace function private.prepared_aggregate_dependency_common(p_scope text)returns text language plpgsql stable as $$begin perform set_config('test.memo_common_calls',(coalesce(nullif(current_setting('test.memo_common_calls',true),''),'0')::integer+1)::text,false);return(select md5(p_scope||':'||revision::text)from private.fixture_common_revision where scope=p_scope);end$$;`);
 // Warm the unchanged original base worker before applying the metadata-only
 // reader patch. These publications deliberately retain null source coverage.
 qs=[1,2,3].map(i=>{const q=f.q(i);delete q.providers;return q;});for(const q of qs)await h.warm(q);
 const worker=fs.readFileSync(path.join(root,'supabase/maintenance/daily-provider-worker-reuse.sql'),'utf8');for(const n of ['schema.sql','names.sql','helpers.sql'])await db.exec(block(worker,n));
 const lifecycle=fs.readFileSync(path.join(root,'supabase/maintenance/daily-provider-missing-day-admission.sql'),'utf8');for(const n of ['admit-days','enqueue','prewarm','claim'])await db.exec(block(lifecycle,n));
 oldExact=block(undo,1);oldReader=block(undo,2);newExact=block(operation,1);newReader=block(operation,2);await modes(false);
 assert.equal(await scalar("select md5(prosrc)from pg_proc where oid='private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'::regprocedure"),'23b803f922a76c04900ca4bf6eca6169');
 assert.equal(await scalar("select md5(prosrc)from pg_proc where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure"),'2d192bb43a5fdfb07230bc8a5f6d859f');
});
after(()=>close?.());
test('three-native selectors and both directions preserve complete original JSONB/text and immutable financial publications',async()=>{
 await modes(false);await db.exec('create temp table fixture_common_oracle(id integer,q jsonb,v jsonb)');let id=0;
 for(const providers of [undefined,['Brand'],['Absent']])for(const direction of ['charge','withdraw']){const requests=qs.map(q=>({...q,direction,...(providers?{providers}:{})}));await db.query("insert into fixture_common_oracle select $1,$2,$3::jsonb",[id++,{publicationVersion:2,requests},await exact(requests)]);}
 assert.equal(await scalar("select bool_and(jsonb_array_length(v->'items')=3 and not exists(select 1 from jsonb_array_elements(v->'items')i where i->>'status'<>'ready'))from fixture_common_oracle"),true);
 const original=await state();await modes(true);for(const x of(await db.query("select *from fixture_common_oracle order by id")).rows){const actual=await exact(x.q.requests);assert.equal(await scalar("select $1::jsonb=$2::jsonb and($1::jsonb)::text=($2::jsonb)::text",[actual,x.v]),true);}assert.deepEqual(await state(),original);
});
test('same-scope exact loop reads one local token plus final proof, without per-native repeats',async()=>{
 const calls=async newer=>{await modes(newer);await db.exec("select set_config('test.memo_common_calls','0',false)");assert.equal((await exact()).items.filter(i=>i.status==='ready').length,3);return Number(await scalar("select current_setting('test.memo_common_calls')"));};
 assert((await calls(false))>=3);assert.equal(await calls(true),2);
 assert(oldReader.includes("'dependency',dep)"));assert(newReader.includes("'dependency',dep,'scopeCommon',common)"));
});
test('real synthetic config revision before final proof rejects the exact shortcut and transaction rollback restores clocks/data',async()=>{
 await modes(true);const original=await state(),token=await scalar("select private.prepared_aggregate_dependency_common('IN')");await db.exec('begin');
 try{const anchor='for scope,common in select key,value from jsonb_each_text(commons)loop';assert.equal(newExact.split(anchor).length,2);await db.exec(newExact.replace(anchor,"update private.fixture_common_revision set revision=revision+1;\n "+anchor));
 assert.equal(await exact(qs,true),null);
 }finally{await db.exec('rollback');}assert.equal(await scalar("select private.prepared_aggregate_dependency_common('IN')"),token);assert.deepEqual(await state(),original);
});
test('public metadata spoofing and permission denial remain rejected; matching internal fallback API accepts no public token',async()=>{
 await modes(true);await assert.rejects(f.call(qs,{scopeCommon:'0'.repeat(32)}),e=>e.code==='22023');await f.auth('assigned',{permissions:['providers.view']});await assert.rejects(f.call(qs),e=>e.code==='42501');await f.auth();
 assert.equal((await exact()).items.length,3);assert.equal(await exact(qs,'not-a-server-token'),null);assert.doesNotMatch(operation,/create(?: or replace)? function private\.prepared_aggregate_dependency_common/i);
});
