const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const baseline=fs.readFileSync(path.join(__dirname,'fixtures/intake-coverage-record-production.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261010135644_intake_coverage_source_record_reset.sql'),'utf8');
const ids={unknown:'1'.repeat(32),kb:'2'.repeat(32),duoli:'3'.repeat(32),lg:'4'.repeat(32)};
const feed=(kind,extra={})=>({id:ids[kind],dataset:kind==='unknown'?'unsupported_fixture':'orders',system:kind,rawCountry:'IN',rawPlatform:`Synthetic-${kind}`,direction:'charge',timezone:'Asia/Kolkata',sourceKind:'direct',...extra});
const evidence=(marker,extra={})=>({received:true,seen:'2026-10-09T20:00:00Z',status:'complete',evidence:'source_day_verified',count:2,complete:true,zeroConfirmed:false,createdCoverageAvailable:true,progress:{marker},...extra});
let db,updated,beforeMeta;
const meta=async()=>(await db.query("select to_jsonb(p)-'prosrc' metadata,p.prosrc body from pg_proc p where oid='private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure")).rows[0];
const call=async(kinds,startAt='2026-10-09',endAt=startAt)=>(await db.query('select private.dashboard_admin_live_intake_coverage($1::jsonb) result',[JSON.stringify({operation:'rows',feedIds:kinds.map(k=>ids[k]),startAt,endAt})])).rows[0].result;
const addFeed=async(kind,extra={})=>db.query('insert into fixture_feeds values($1::jsonb)',[JSON.stringify(feed(kind,extra))]);
const addEvidence=async(kind,day,value)=>db.query('insert into fixture_evidence values($1,$2,$3::jsonb)',[kind,day,JSON.stringify(value)]);
const clock=definition=>definition.replace('v_asof timestamptz:=statement_timestamp();',"v_asof timestamptz:='2026-10-10T12:00:00Z';");
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;set check_function_bodies=off;
 create table fixture_feeds(value jsonb);create table fixture_evidence(kind text,day date,value jsonb);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if current_setting('test.denied',true)='yes' then raise exception 'application_session_denied';end if;return '{}'::jsonb;end$$;
 create function private.dashboard_admin_live_intake_feeds(timestamptz) returns jsonb language sql stable as $$select coalesce(jsonb_agg(value),'[]'::jsonb) from public.fixture_feeds$$;
 create function private.dashboard_admin_live_intake_order_feeds(timestamptz) returns jsonb language sql stable as $$select coalesce(jsonb_agg(value),'[]'::jsonb) from public.fixture_feeds where value->>'dataset'='orders'$$;
 create function private.dashboard_admin_wg_current_feeds(jsonb) returns jsonb language sql immutable as $$select $1$$;
 create function private.dashboard_admin_yash_day_evidence(text,text,text,date) returns jsonb language sql stable as $$select coalesce((select value from public.fixture_evidence where kind='kb' and day=$4),'{"received":false,"seen":null,"status":"not_received","evidence":"source_window_uncovered","count":0,"complete":false,"zeroConfirmed":false,"createdCoverageAvailable":false}'::jsonb)$$;
 create function private.dashboard_admin_duoli_day_evidence(text,text,date) returns jsonb language sql stable as $$select coalesce((select value from public.fixture_evidence where kind='duoli' and day=$3),'{"received":false,"seen":null,"status":"not_received","evidence":"source_window_uncovered","count":0,"complete":false,"zeroConfirmed":false,"createdCoverageAvailable":false}'::jsonb)$$;
 create table public.lg_sync_runs(country_code text,platform text,order_kind text,sync_mode text,status text,stat_date date,observed_at timestamptz,published_at timestamptz,expected_count bigint,source_total bigint,fetched_count bigint);
 create table public.lg_orders(country_code text,platform text,order_kind text,created_at timestamptz,paid_at timestamptz,received_at timestamptz,updated_at timestamptz);
 create table private.lg_window_cursors(platform text,country_code text,order_kind text,stream text,origin_at timestamptz,cursor_at timestamptz);
 `);await db.exec(baseline);beforeMeta=await meta();
 await addFeed('unknown');await db.exec(clock(baseline));await assert.rejects(()=>call(['unknown']),/record "v_run" is not assigned yet/);await db.exec(baseline);await db.exec('truncate fixture_feeds');
 await db.exec(migration);assert.deepEqual((await meta()).metadata,beforeMeta.metadata);
 updated=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure) definition")).rows[0].definition;
});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('begin');await db.exec(clock(updated));});
afterEach(async()=>db.exec('rollback'));

test('a first non-window feed no longer reads an unassigned record or changes unknown coverage into complete zero',async()=>{
 await addFeed('unknown');const r=(await call(['unknown'])).rows[0];assert.equal(r.status,'unverified');assert.equal(r.evidence,'unsupported_source');assert.equal(r.complete,false);assert.equal(r.zeroConfirmed,false);assert.equal(r.received,false);assert(!('sourceWindowCoverage' in r));
});
test('future dates return no rows and uncovered native dates keep null source-window evidence',async()=>{
 await addFeed('kb');assert.deepEqual((await call(['kb'],'2026-10-11')).rows,[]);const r=(await call(['kb'])).rows[0];assert.equal(r.complete,false);assert.equal(r.zeroConfirmed,false);assert.equal(r.sourceWindowCoverage,null);assert.equal(r.createdCoverageAvailable,false);
});
test('kb and duoli each emit only their own receipt in a mixed source loop',async()=>{
 await addFeed('kb');await addFeed('duoli');await addEvidence('kb','2026-10-09',evidence('kb-receipt'));await addEvidence('duoli','2026-10-09',evidence('duoli-receipt',{complete:false,status:'partial',createdCoverageAvailable:false}));
 const rows=(await call(['kb','duoli'])).rows;assert.equal(rows.length,2);const kb=rows.find(r=>r.feedId===ids.kb),duoli=rows.find(r=>r.feedId===ids.duoli);assert.deepEqual(kb.sourceWindowCoverage,{marker:'kb-receipt'});assert.deepEqual(duoli.sourceWindowCoverage,{marker:'duoli-receipt'});assert.equal(kb.complete,true);assert.equal(duoli.complete,false);assert.equal(duoli.createdCoverageAvailable,false);
});
test('a missing receipt on a later day never reuses the previous day progress or completeness',async()=>{
 await addFeed('kb');await addEvidence('kb','2026-10-08',evidence('prior',{count:0,zeroConfirmed:true}));const rows=(await call(['kb'],'2026-10-08','2026-10-09')).rows;assert.equal(rows[0].complete,true);assert.equal(rows[0].zeroConfirmed,true);assert.deepEqual(rows[0].sourceWindowCoverage,{marker:'prior'});assert.equal(rows[1].sourceWindowCoverage,null);assert.equal(rows[1].createdCoverageAvailable,false);assert.equal(rows[1].complete,false);assert.equal(rows[1].zeroConfirmed,false);
});
test('a preceding LG record with a different row shape does not break or contaminate kb evidence',async()=>{
 await addFeed('lg');await addFeed('kb');await addEvidence('kb','2026-10-09',evidence('kb-after-lg'));const rows=(await call(['lg','kb'])).rows;const lg=rows.find(r=>r.feedId===ids.lg),kb=rows.find(r=>r.feedId===ids.kb);assert.equal(lg.complete,false);assert.equal(lg.zeroConfirmed,false);assert(!('sourceWindowCoverage'in lg));assert.deepEqual(kb.sourceWindowCoverage,{marker:'kb-after-lg'});assert.equal(kb.complete,true);
});
test('fresh session and feed scope validation remain mandatory',async()=>{
 await addFeed('kb');await db.exec("select set_config('test.denied','yes',true)");await db.exec('savepoint denial');try{await assert.rejects(()=>call(['kb']),/application_session_denied/);}finally{await db.exec('rollback to savepoint denial');}await db.exec("select set_config('test.denied','no',true)");await db.exec('savepoint scope');try{await assert.rejects(()=>call(['duoli']),/coverage_feed_denied/);}finally{await db.exec('rollback to savepoint scope');}
});
test('migration is idempotent and rejects privilege, settings and unrelated body drift',async()=>{
 await db.exec(updated);const current=await meta();await db.exec(migration);await db.exec(migration);assert.deepEqual(await meta(),current);assert.deepEqual(current.metadata,beforeMeta.metadata);await db.exec('begin');
 for(const mutate of ["grant execute on function private.dashboard_admin_live_intake_coverage(jsonb) to anon","alter function private.dashboard_admin_live_intake_coverage(jsonb) set jit=on"]){await db.exec('savepoint drift');await db.exec(mutate);await assert.rejects(()=>db.exec(migration),/metadata_drift/);await db.exec('rollback');await db.exec('begin');await db.exec(updated);}
 await db.exec(updated.replace('begin\n','begin\n -- newer unrelated code\n'));await assert.rejects(()=>db.exec(migration),/baseline_drift/);await db.exec('rollback');await db.exec('begin');await db.exec(updated);
});
