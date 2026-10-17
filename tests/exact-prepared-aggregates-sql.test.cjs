const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{setup}=require('./fixtures/provider-snapshot-harness.cjs');
let db,targets,catalogBefore,aclBefore,providerTokenBefore;
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261015141000_exact_prepared_aggregates.sql'),'utf8');
const OWNER='10000000-0000-4000-8000-000000000001',STAFF='10000000-0000-4000-8000-000000000002',ROLE='20000000-0000-4000-8000-000000000001';
async function val(sql,args=[]){return(await db.query(sql,args)).rows[0]?.value;}
const req=(t=targets[0],extra={})=>({action:'aggregate',view:'providers',platformId:t.id,startAt:'2026-10-13T18:30:00Z',endAt:'2026-10-14T18:30:00Z',direction:'all',status:'all',currency:'INR',offset:0,limit:20,...extra});
async function read(qs=[req()],page='providers'){return val('select public.dashboard_admin_aggregate_prepared($1,$2) value',[page,JSON.stringify({requests:qs})]);}
async function reason(q,t=targets[0]){return val('select private.prepared_aggregate_request_reason($1,$2) value',[JSON.stringify(q),JSON.stringify(t)]);}
test.before(async()=>{
 db=await setup();
 const fees=fs.readFileSync(path.join(__dirname,'fixtures/provider-snapshot-fee-dependency/fixture.sql'),'utf8');
 for(const stmt of fees.split('\n').filter(line=>/^create table (private[.]fee_rate_|public[.]third_party_rates)/.test(line)))await db.exec(stmt.replace("create table ","create table if not exists "));
 await db.exec(fees.slice(fees.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_data_group'),fees.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_fee_category')));
 for(const filename of ['20260930225000_duration_precision_ranges.sql','20260928092956_admin_live_dynamic_amount_bands.sql']){const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations',filename),'utf8');await db.exec(sql.slice(sql.indexOf('create or replace function'),sql.indexOf('revoke all')));}
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/admin-live-provider-aliases.sql'),'utf8'));
 await db.exec(`create function private.dashboard_admin_live_provider_canonical(country text,platform text,raw text)returns text language sql stable set search_path=''as $$select private.dashboard_admin_live_provider_alias(country,raw)$$;`);
 providerTokenBefore=await val("select private.provider_snapshot_dependency_token('{}'::jsonb)value");
 catalogBefore=await val('select private.dashboard_role_catalog()value');
 aclBefore=await val("select coalesce(proacl::text,'')value from pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure");
 await db.exec(migration);
 await db.exec(`insert into public.ar_config_targets values('AR','IN','SYNTHETIC_A','INR','印度','Asia/Kolkata'),('AR','IN','SYNTHETIC_B','INR','印度','Asia/Kolkata');insert into private.test_native_catalog select *from private.provider_snapshot_native_catalog()where source='ar';`);
 targets=(await db.query('select to_jsonb(p)value from private.test_native_catalog p order by name')).rows.map(r=>r.value);
 // Native catalog fixture replaces only source-table discovery, never reader
 // permissions, request admission, clocks, job state, or publication behavior.
 await db.exec(`create or replace function private.prepared_aggregate_native_catalog()returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)language sql stable set search_path=''as $$select *from private.test_native_catalog$$;`);
 await db.query(`insert into public.dashboard_profiles values($1,'owner',true,'{"mode":"all","countries":[]}'),($2,'admin',true,'{"mode":"all","countries":[]}');`,[OWNER,STAFF]);
 await db.query('insert into public.dashboard_admin_preview_grants values($1,true)',[STAFF]);
 await db.query(`insert into private.dashboard_roles values($1,'Synthetic role',array['providers.view','providers.query'],1,true)`,[ROLE]);
 await db.query('insert into private.dashboard_role_assignments values($1,$2,1)',[STAFF,ROLE]);
});
test.after(async()=>{await db?.close()});
test.beforeEach(async()=>{await db.exec('reset role;truncate private.prepared_aggregate_heads,private.prepared_aggregate_artifacts,private.prepared_aggregate_jobs,private.prepared_aggregate_admissions;');await db.query("select set_config('test.actor',$1,false),set_config('test.session_allowed','true',false),set_config('test.ip_allowed','true',false)",[OWNER]);});
test('read admits one exact background job and never calculates source data',async()=>{let r=await read();assert.equal(r.items[0].status,'missing');assert.equal(r.items[0].result,null);r=await read();assert.equal(r.items[0].status,'building');assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);assert.equal(await val('select count(*)value from private.prepared_aggregate_artifacts'),0);});
test('unauthorized batch rejects before any queue admission',async()=>{await assert.rejects(read([req(),req(targets[0],{platformId:'00000000-0000-4000-8000-000000000000'})]),e=>e.code==='42501');assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),0);await assert.rejects(read([req()],'rates'),e=>e.code==='42501');});
test('dual windows are distinct exact keys and source-updated never uses ingest timestamps',async()=>{const q=req();assert.equal(await reason(q),null);assert.equal(await reason({...q,successStartAt:'2026-10-11T00:00:00Z',successEndAt:'2026-10-12T00:00:00Z',successBasis:'success'}),null);assert.equal(await reason({...q,successBasis:'source_updated'}),null);assert.equal(await val('select private.prepared_aggregate_secondary_reason($1,$2)value',[JSON.stringify({...q,successBasis:'source_updated'}),JSON.stringify(targets[0])]),'source_update_time_unavailable');await read([q,{...q,successStartAt:'2026-10-11T00:00:00Z',successEndAt:'2026-10-12T00:00:00Z',successBasis:'success'}]);assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),2);});
test('unsupported drilldown or malformed filters enqueue nothing',async()=>{const result=await read([req(targets[0],{view:'drilldown'}),req(targets[0],{amountMin:'NaN'})]);assert.deepEqual(result.items.map(x=>x.status),['unsupported','unsupported']);assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),0);});
test('assigned role uses signed original page permission and revocation remains fail closed',async()=>{await db.exec('set role authenticated');await db.query("select set_config('test.actor',$1,false)",[STAFF]);assert.equal((await read()).items[0].status,'missing');await assert.rejects(read([req()],'overview'),e=>e.code==='42501');await db.exec('reset role');await db.query('update private.dashboard_roles set active=false where id=$1',[ROLE]);await db.exec('set role authenticated');await assert.rejects(read(),e=>e.code==='42501');await db.exec('reset role');await db.query('update private.dashboard_roles set active=true where id=$1',[ROLE]);});
const canonical=async q=>val('select private.prepared_aggregate_canonical_request($1,$2)value',[JSON.stringify(q),JSON.stringify(targets[0])]);
async function claim(){return val("select private.prepared_aggregate_claim('synthetic-worker')value")}
function payload(q=req(),extra={}){const t=targets.find(x=>x.id===q.platformId),row={provider:'SelectedPay',direction:'charge',currency:'INR',all_count:2,all_amount:'3.123456789',success_count:1,success_amount:'1.123456789',pending_count:1,pending_amount:'2',failed_count:0,failed_amount:'0',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',fee_low_count:1,fee_low_amount:'1.123456789'};return{version:1,platform:{id:t.id,name:t.name,source:t.source,sourceName:t.source_name,country:t.country,scopeGroup:t.scope_group,currency:t.currency,timezone:t.timezone},startAt:q.startAt,endAt:q.endAt,successStartAt:q.successStartAt||q.startAt,successEndAt:q.successEndAt||q.endAt,successBasis:q.successBasis||'success',asOf:new Date().toISOString(),rows:[],summary:[{...row,provider:null}],groups:{provider:[row]},total:2,hasMore:true,limit:20,offset:0,...extra}}
const complete=(c,p=payload())=>val('select private.prepared_aggregate_complete($1,$2,$3,$4)value',[c.jobId,c.runId,c.fence,JSON.stringify(p)]);
async function publish(q=req()){await read([q]);const c=await claim();assert.ok(c);return{c,r:await complete(c,payload(q))};}
test('semantic key unifies defaults and microsecond offset spellings without combining clocks',async()=>{
 const a=req(),b={...a,successStartAt:'2026-10-14T00:00:00.000000+05:30',successEndAt:'2026-10-15T00:00:00.000000+05:30',successBasis:'success',startAt:'2026-10-14T00:00:00.000000+05:30',endAt:'2026-10-15T00:00:00.000000+05:30',amountBands:{charge:[0,100,200,300,400,500,600,700,800,900,1000]},limit:100};
 assert.deepEqual(await canonical(a),await canonical(b));assert.notDeepEqual(await canonical(a),await canonical({...b,successEndAt:'2026-10-15T00:00:00.000001+05:30'}));
 await read([a,b]);assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);
});
test('valid publication survives scheduled refresh; expired or changed permission never returns ready',async()=>{
 const {r}=await publish();assert.equal(r.published,true);let x=await read();assert.equal(x.items[0].status,'ready');assert.equal(x.items[0].publication.sourceComplete,false);assert.equal(x.items[0].publication.calculationComplete,true);assert.equal(x.items[0].result.hasMore,false);
 await db.exec("update private.prepared_aggregate_jobs set status='queued',last_requested_at=clock_timestamp()-interval'1hour'");x=await read();assert.equal(x.items[0].status,'ready');assert.equal(await val("select last_requested_at>clock_timestamp()-interval'1minute'value from private.prepared_aggregate_jobs"),true);
 await db.query("select set_config('test.ip_allowed','false',false)");await assert.rejects(read(),e=>e.code==='42501');await db.query("select set_config('test.ip_allowed','true',false)");
 // Delete immutable head and publish a fixture expiry through fresh insertion,
 // never weaken artifact immutability even inside a test.
 await db.exec("insert into private.prepared_aggregate_artifacts select gen_random_uuid(),job_id,gen_random_uuid(),fence,revision,dependency,payload,computed_at,clock_timestamp()-interval'1second',cutoff,source_complete,bytes from private.prepared_aggregate_artifacts;update private.prepared_aggregate_heads set artifact_id=(select id from private.prepared_aggregate_artifacts order by expires_at limit 1)");
 x=await read();assert.equal(x.items[0].status,'stale');assert.equal(x.items[0].result,null);
});
test('immutable artifacts reject updates and malformed/incomplete payload never publishes',async()=>{
 await read();const c=await claim();for(const bad of [{version:null},{rows:null},{successBasis:'source_updated'},{successEndAt:'2026-10-16T00:00:00Z'},{partial:true},{groups:{provider:null}}])await assert.rejects(complete(c,payload(req(),bad)),e=>e.code==='22023');
 assert.equal(await val('select count(*)value from private.prepared_aggregate_artifacts'),0);assert.equal((await complete(c)).published,true);await assert.rejects(db.exec("update private.prepared_aggregate_artifacts set bytes=2"),e=>e.code==='55000');assert.equal((await complete(c)).published,false);
});
test('expired worker cannot overwrite the current fence or a changed semantic dependency',async()=>{
 await read();const old=await claim();await db.exec("update private.prepared_aggregate_jobs set lease_until=clock_timestamp()-interval'1second'");assert.equal(await claim(),null);await db.exec("update private.prepared_aggregate_jobs set not_before=clock_timestamp()");const latest=await claim();assert.ok(latest.fence>old.fence);assert.equal((await complete(old)).published,false);assert.equal((await complete(latest)).published,true);
 await db.exec("update private.prepared_aggregate_jobs set status='queued',dependency='synthetic-obsolete'");const next=await claim();assert.equal((await complete(next)).reason,'dependency_changed');assert.equal((await read()).items[0].status,'stale');
});
test('provider selections share a single queued base and ready projection keeps exact fee and nullable facts',async()=>{
 const a=req(targets[0],{providers:['SelectedPay'],direction:'charge'}),b=req(targets[0],{providers:['Another'],direction:'withdraw'});await read([a,b]);assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);assert.equal(await val("select request?'providers'value from private.prepared_aggregate_jobs"),false);
 const c=await claim();await complete(c);const x=await read([a,b]);assert.deepEqual(x.items.map(i=>i.status),['ready','ready']);assert.equal(x.items[0].result.total,2);assert.equal(x.items[0].result.groups.provider[0].fee_low_amount,'1.123456789');assert.equal(x.items[1].result.total,0);assert.deepEqual(x.items[1].result.summary,[]);assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);
});
test('private worker storage and helper functions are unavailable to external roles',async()=>{
 assert.equal(await val("select private.provider_snapshot_dependency_token('{}'::jsonb)value"),providerTokenBefore);

 for(const role of ['anon','authenticated','service_role']){for(const name of ['private.prepared_aggregate_claim(text)','private.prepared_aggregate_complete(uuid,uuid,bigint,jsonb)','private.prepared_aggregate_raw_kernel(jsonb,jsonb)','private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'])assert.equal(await val('select has_function_privilege($1,$2,\'EXECUTE\')value',[role,name]),false);assert.equal(await val("select has_table_privilege($1,'private.prepared_aggregate_jobs','SELECT')value",[role]),false);}
});
test('prewarm seeds three logical views from one mutable full-v2 master and preserves cheap closed days',async()=>{
 assert.equal((await val('select private.prepared_aggregate_prewarm()value')).status,'disabled');await db.exec('update private.prepared_aggregate_schedule set enabled=true,cursor_id=null,cursor_tier=0');
 try{const r=await val("select private.prepared_aggregate_prewarm('2026-10-15T01:00:00Z')value");assert.equal(r.requests,14);assert.equal(r.backgroundJobs,6);const qs=(await db.query('select request from private.prepared_aggregate_jobs')).rows.map(x=>x.request);assert.equal(qs.filter(x=>x.view==='providers').length,2);assert.equal(qs.filter(x=>x.view==='full').length,4);assert.equal(qs.filter(x=>x.durationVersion===2).length,4);assert.ok(qs.every(x=>new Date(x.startAt).getUTCHours()===18&&new Date(x.startAt).getUTCMinutes()===30&&new Date(x.endAt)-new Date(x.startAt)===86400000&&x.successBasis==='success'));assert.ok(qs.filter(x=>x.view==='full').every(x=>x.amountBands.charge.length===11&&x.amountBands.withdraw.length===11));}
 finally{await db.exec('update private.prepared_aggregate_schedule set enabled=false,cursor_id=null,cursor_tier=0')}
});
test('31 local days across DST are accepted while more local days are bounded',async()=>{
 const t={...targets[0],timezone:'America/New_York'};const q=req(t,{startAt:'2026-10-15T00:00:00-04:00',endAt:'2026-11-15T00:00:00-05:00'});assert.equal(await reason(q,t),null);assert.equal(await reason({...q,endAt:'2026-11-16T00:00:00-05:00'},t),'invalid_time_range');
});
test('only the same 17 existing pages receive the prepared action',async()=>{
 const pages=await val("select jsonb_agg(p->>'id'order by p->>'id')value from jsonb_array_elements(private.dashboard_role_catalog()->'pages')p where p->'requests'?'aggregatePrepared'");assert.deepEqual(pages,['overview','collection','payout','merchants','providers','provider_payout','success_analysis','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','daily_comparison'].sort());
 const current=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/lib/dashboardRoleCatalog.json'),'utf8'));
 assert.deepEqual(pages,current.pages.filter(p=>p.requests.includes('aggregatePrepared')).map(p=>p.id).sort());
 const after=await val('select private.dashboard_role_catalog()value');
 assert.deepEqual({...after,pages:after.pages.map(p=>({...p,requests:p.requests.filter(x=>x!=='aggregatePrepared')}))},catalogBefore);
 assert.equal(await val("select coalesce(proacl::text,'')value from pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure"),aclBefore);
 const other=await val("select p->>'id'value from jsonb_array_elements(private.dashboard_role_catalog()->'pages')p where p->'requests'?'aggregate'and not(p->'requests'?'aggregatePrepared')limit 1");assert.ok(other);await assert.rejects(read([req()],other),e=>e.code==='42501');
});

test('actual browser prepared adapter accepts PostgreSQL envelopes and rejects stale data without fallback',async()=>{
 const helper=require('../admin-preview/live-prepared-aggregates.js');const q=req(targets[0],{successStartAt:'2026-10-11T00:00:00.000001Z',successEndAt:'2026-10-12T00:00:00.000001Z',successBasis:'success'});await publish(q);
 const client=helper.create({request:body=>read(body.requests),context:()=> 'synthetic-owner/providers',platform:()=>payload(q).platform});
 const r=await client.read(q);assert.equal(r._preparedPublication.status,'ready');assert.equal(r._preparedPublication.calculationComplete,true);assert.equal(r._preparedPublication.sourceComplete,false);assert.equal(r.successStartAt,q.successStartAt);
 const selected=await client.read({...q,providers:['SelectedPay'],direction:'charge'});assert.equal(selected.total,2);assert.equal(selected.groups.provider[0].fee_low_amount,'1.123456789');assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);
 await db.exec("delete from private.prepared_aggregate_heads");await assert.rejects(client.read(q),e=>e.code==='PREPARED_AGGREGATE_MISSING');client.clear();
});

test('changed native clock predicates fail closed before any calculation',async()=>{
 for(const source of ['newar','lg','kb','duoli','wg','ar','game66'])await assert.rejects(val('select private.prepared_aggregate_source_clocks($1,$2,$3)value',['select unexpected_field as raw_provider from changed_native_source',source,'success']),e=>e.code==='55000');
 await assert.rejects(val('select private.prepared_aggregate_source_clocks($1,$2,$3)value',['select n.provider as raw_provider from native n where n.success_at >= $5 and n.success_at<$6','newar','success']),e=>e.code==='55000');
});

test('large valid exact filters use a bounded index and retain full semantic equality',async()=>{
 const providers=Array.from({length:200},(_,i)=>require('node:crypto').createHash('sha512').update('synthetic-filter-'+i).digest('hex'));
 const q=req(targets[0],{view:'full',providers});assert.equal(await reason(q),null);assert.equal((await read([q])).items[0].status,'missing');assert.equal((await read([q])).items[0].status,'building');
 const row=(await db.query('select request_fingerprint,request from private.prepared_aggregate_jobs')).rows[0];assert.equal(row.request_fingerprint.length,32);assert.deepEqual(row.request.providers,providers);
 assert.equal(await val("select indexdef like '%request_fingerprint%'value from pg_indexes where indexname='prepared_aggregate_jobs_request_fingerprint_key'"),true);
});

test('readiness starts from every expected profile including tasks never enqueued',async()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/operations/exact_prepared_aggregates_readiness.sql'),'utf8').split('commit;')[0]+'commit;';
 let rows=(await db.exec(sql)).flatMap(r=>r.rows||[]);assert.equal(rows.length,14);assert.ok(rows.every(r=>r.expected_profiles===14&&r.status==='not_enqueued'&&r.readable_valid===false));
 await db.exec('update private.prepared_aggregate_schedule set enabled=true,cursor_id=null,cursor_tier=0');
 try{await val('select private.prepared_aggregate_prewarm()value');rows=(await db.exec(sql)).flatMap(r=>r.rows||[]);assert.equal(rows.length,14);assert.ok(rows.every(r=>r.status==='queued'&&r.readable_valid===false));}
 finally{await db.exec('update private.prepared_aggregate_schedule set enabled=false,cursor_id=null,cursor_tier=0')}
});

const bands={charge:[100,200,300,400,500,1000,2000,5000,10000,20000,50000],withdraw:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]};
async function hotRequest(){const dates=await val("select jsonb_build_object('startAt',private.provider_snapshot_iso(date_trunc('day',now())),'endAt',private.provider_snapshot_iso(date_trunc('day',now())+interval'1day'))value");return req(targets[0],{...dates,successStartAt:dates.startAt,successEndAt:dates.endAt,successBasis:'success'});}
function masterPayload(q){return payload(q,{durationVersion:2,groups:{provider:payload(q).groups.provider,daily:[],hourly:[],amount:[],matrix:[],amount_range:[],matrix_range:[],latency:[],latency_thresholds:[],pending_age:[],pending_age_thresholds:[]},latencySummary:[],pendingSummary:[],amountBands:q.amountBands,amountBandsVersion:1});}
async function publishMaster(q){await read([q]);const c=await claim();const b=await val('select request value from private.prepared_aggregate_jobs where id=$1',[c.jobId]);assert.equal(b.durationVersion,2);assert.equal((await complete(c,masterPayload(b))).published,true);return{c,b};}
test('one hot master serves all three views, provider/direction changes and exact frontend envelopes',async()=>{
 const p=await hotRequest(),full={...p,view:'full',amountBands:bands},v2={...full,durationVersion:2};
 assert.deepEqual((await read([p,full,v2])).items.map(x=>x.status),['missing','building','building']);assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);
 const c=await claim(),base=await val('select request value from private.prepared_aggregate_jobs where id=$1',[c.jobId]);assert.equal(base.durationVersion,2);assert.equal((await complete(c,masterPayload(base))).published,true);
 const qs=[p,full,v2,{...p,providers:['SelectedPay'],direction:'charge'}],r=await read(qs);assert.ok(r.items.every(x=>x.status==='ready'));assert.equal(new Set(r.items.map(x=>x.publication.id)).size,1);assert.equal(r.items[0].result.durationVersion,undefined);assert.deepEqual(Object.keys(r.items[0].result.groups),['provider']);assert.equal(r.items[1].result.durationVersion,undefined);assert.equal(r.items[2].result.durationVersion,2);assert.equal(r.items[3].result.groups.provider[0].fee_low_amount,'1.123456789');
 const helper=require('../admin-preview/live-prepared-aggregates.js'),client=helper.create({request:body=>read(body.requests),context:()=> 'synthetic-owner/providers',platform:()=>payload(p).platform});for(const q of qs){const dto=await client.read(q);assert.equal(dto._preparedPublication.status,'ready');}client.clear();
 await db.query("select set_config('test.session_allowed','false',false)");await assert.rejects(read(qs),e=>e.code==='42501');assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);
});
test('independent second clock, bands, native and filters never borrow another master',async()=>{
 const p=await hotRequest(),full={...p,view:'full',amountBands:bands};await publishMaster(full);
 const different=[{...full,successEndAt:new Date(Date.parse(full.successEndAt)+1).toISOString()},{...full,successBasis:'source_updated'},{...full,amountBands:{...bands,charge:[100,201,300,400,500,1000,2000,5000,10000,20000,50000]}},{...full,platformId:targets[1].id},{...full,amountMin:200},{...full,providers:['SelectedPay']}];
 assert.ok((await read(different)).items.every(x=>x.status==='missing'));assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),7);
 await assert.rejects(read([{...full,platformId:'00000000-0000-4000-8000-000000000000'}]),e=>e.code==='42501');assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),7);
});
test('old exact defaults retire only after valid master; running leases and separate old snapshots survive',async()=>{
 const p=await hotRequest(),base=await val('select private.prepared_aggregate_base_request($1,$2)value',[JSON.stringify(p),JSON.stringify(targets[0])]);
 const dep=await val('select private.prepared_aggregate_dependency($1)value',[JSON.stringify(targets[0])]);
 const old=await val('select private.prepared_aggregate_enqueue($1,$2,$3)value',[JSON.stringify(p),JSON.stringify(targets[0]),dep]);
 const retire=()=>val('select private.prepared_aggregate_retire_replaced($1,$2,$3,$4)value',[JSON.stringify(p),JSON.stringify(targets[0]),JSON.stringify(base),dep]);assert.equal(await retire(),false);
 await db.query("update private.prepared_aggregate_jobs set status='failed',attempts=3 where id=$1",[old]);await publishMaster(p);
 await db.query("update private.prepared_aggregate_jobs set status='running',lease_until=now()+interval'1minute' where id=$1",[old]);assert.equal(await retire(),false);
 await db.query("update private.prepared_aggregate_jobs set status='queued',lease_until=null,attempts=0 where id=$1",[old]);const oldQueue=await val('select count(*)value from private.provider_snapshot_jobs');assert.equal(await retire(),true);assert.equal(await val('select last_error value from private.prepared_aggregate_jobs where id=$1',[old]),'superseded_by_full_master');assert.equal(await val('select count(*)value from private.provider_snapshot_jobs'),oldQueue);
 assert.equal(await claim(),null);assert.equal((await read([p])).items[0].status,'ready');
 // Once this becomes a cheap closed-day request, admission can revive it safely.
 await val('select private.prepared_aggregate_enqueue($1,$2,$3)value',[JSON.stringify(p),JSON.stringify(targets[0]),dep]);assert.equal(await val('select attempts value from private.prepared_aggregate_jobs where id=$1',[old]),0);
});
test('readiness resolves all logical views to fewer exact jobs including missing defaults',async()=>{
 await db.exec('update private.prepared_aggregate_schedule set enabled=true,cursor_id=null,cursor_tier=0');try{await val('select private.prepared_aggregate_prewarm()value');const sql=fs.readFileSync(path.join(__dirname,'../supabase/operations/exact_prepared_aggregates_readiness.sql'),'utf8').split('commit;')[0]+'commit;';const rows=(await db.exec(sql)).flatMap(r=>r.rows||[]);assert.equal(rows.length,14);assert.equal(new Set(rows.map(x=>x.resolved_job_id)).size,6);assert.equal(rows.filter(x=>x.base_duration_version==='2').length,12);assert.ok(rows.every(x=>x.readable_valid===false));}
 finally{await db.exec('update private.prepared_aggregate_schedule set enabled=false,cursor_id=null,cursor_tier=0')}
});
test('two simulated refresh generations remain shared while queued/running and expiry never falls back to raw',async()=>{
 const p=await hotRequest(),qs=[p,{...p,view:'full',amountBands:bands},{...p,view:'full',amountBands:bands,durationVersion:2}];await publishMaster(p);let previous=(await read(qs)).items[0].publication;
 for(let i=0;i<2;i++){await db.exec("update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp()");let ready=await read(qs);assert.ok(ready.items.every(x=>x.status==='ready'&&x.publication.id===previous.id));const c=await claim();ready=await read(qs);assert.ok(ready.items.every(x=>x.status==='ready'&&x.publication.id===previous.id));const b=await val('select request value from private.prepared_aggregate_jobs where id=$1',[c.jobId]);assert.equal((await complete(c,masterPayload(b))).published,true);ready=await read(qs);assert.ok(ready.items.every(x=>x.status==='ready'&&x.publication.id!==previous.id));assert.equal(new Set(ready.items.map(x=>x.publication.generation)).size,1);previous=ready.items[0].publication;}
 await db.exec("insert into private.prepared_aggregate_artifacts select gen_random_uuid(),job_id,gen_random_uuid(),fence,revision,dependency,payload,computed_at,clock_timestamp()-interval'1second',cutoff,source_complete,bytes from private.prepared_aggregate_artifacts order by computed_at desc limit 1;update private.prepared_aggregate_heads set artifact_id=(select id from private.prepared_aggregate_artifacts order by expires_at limit 1)");
 assert.ok((await read(qs)).items.every(x=>x.status==='stale'&&x.result===null));assert.equal(await val('select count(*)value from private.prepared_aggregate_jobs'),1);
});
