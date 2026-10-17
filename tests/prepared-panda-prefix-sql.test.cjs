const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const dir=__dirname,read=n=>fs.readFileSync(path.join(dir,n),'utf8'),baseline=JSON.parse(read('fixtures/prepared-panda-prefix-before.json'));
const migration=read('../supabase/migrations/20261017074658_prepared_panda_verified_prefix.sql');
const source=kind=>{const begin='-- BEGIN PANDA PREFIX FUNCTION '+kind+'\n',end='-- END PANDA PREFIX FUNCTION '+kind;assert.equal(migration.split(begin).length,2);return migration.split(begin)[1].split(end)[0];};
let db,clock;
const one=s=>baseline.find(x=>x.signature===s).definition;
async function tx(f){await db.exec('begin');try{await f();}finally{await db.exec('rollback');}}
async function prefix(direction='all',from=clock.start,to=clock.end){return(await db.query('select panda_private.prepared_window($1,$2,$3,$4)data',['Synthetic',direction,from,to])).rows[0].data;}
async function row(direction,id,at){await db.query('insert into public.panda_order_details values($1,$2,$3,$4,$5)',['synthetic',direction,id,at,clock.observed]);}
let serial=0;
async function receipt(direction,from=clock.start,to=clock.cutoff,{expected,observed=clock.observed,verified=true}={}){
 const scan=String(++serial),count=(await db.query('select count(*)n from public.panda_order_details where platform=$1 and direction=$2 and created_at>=$3 and created_at<$4',['synthetic',direction,from,to])).rows[0].n;
 await db.query('insert into panda_private.order_scans values($1,$2,$3,$4,$5,$6,$7,$7)',[scan,'synthetic',direction,'created_at',from,to,observed]);
 await db.query('insert into public.panda_order_coverage_receipts values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7)',[scan,'synthetic',direction,'created_at',from,to,observed,expected??Number(count),verified,verified?'row_axis_verified':'source_query_membership']);
 await db.query('insert into panda_private.order_scan_members select $1,order_id,created_at from public.panda_order_details where platform=$2 and direction=$3 and created_at>=$4 and created_at<$5',[scan,'synthetic',direction,from,to]);return scan;
}
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema panda_private;create role anon;create role authenticated;create role service_role;
 create table panda_private.order_scopes(platform text,platform_label text,country_code text,region_id int,currency text);
 insert into panda_private.order_scopes values('synthetic','Synthetic','BR',1,'BRL');
 create table panda_private.order_scans(scan_id text,platform text,direction text,window_axis text,window_start timestamptz,window_end timestamptz,observed_at timestamptz,finalized_at timestamptz);
 create table panda_private.order_scan_members(scan_id text,order_id text,axis_value timestamptz);
 create table public.panda_order_details(platform text,direction text,order_id text,created_at timestamptz,received_at timestamptz);
 create table public.panda_order_coverage_receipts(scan_id text,platform text,direction text,window_axis text,window_start timestamptz,window_end timestamptz,observed_at timestamptz,expected_count bigint,row_axis_bounds_verified boolean,coverage_kind text,received_at timestamptz);
 `);
 await db.exec(one('private.dashboard_admin_panda_range_evidence(text,text,timestamp with time zone,timestamp with time zone)'));
 await db.exec(one('private.dashboard_admin_panda_query_coverage(text,text,timestamp with time zone,timestamp with time zone)'));
 await db.exec(source('helpers'));
 clock=(await db.query(`select date_trunc('hour',statement_timestamp())-interval'3hours' as start,date_trunc('hour',statement_timestamp())-interval'1hour'as cutoff,date_trunc('hour',statement_timestamp())-interval'2hours'as middle,statement_timestamp()+interval'3hours'as end,statement_timestamp()-interval'1minute'as observed`)).rows[0];
 for(const k of Object.keys(clock))clock[k]=new Date(clock[k]).toISOString();
 await db.exec(`
 create function private.prepared_aggregate_request_reason(jsonb,jsonb)returns text language sql stable as $$select null::text$$;
 create function private.prepared_aggregate_expand_provider_filter(jsonb,jsonb)returns jsonb language sql stable as $$select $1$$;
 create function private.provider_snapshot_orders_result_kernel(jsonb,jsonb)returns jsonb language sql stable as $$select $1$$;
 create function private.dashboard_admin_panda_capabilities(text)returns jsonb language sql stable as $$select '{"successTimeAvailable":false,"chargeSuccessTimeAvailable":false,"withdrawSuccessTimeAvailable":false,"successCoverageAvailable":false}'::jsonb$$;
 create function private.dashboard_admin_wg_capabilities(text)returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.prepared_aggregate_secondary_reason(jsonb,jsonb)returns text language sql stable as $$select null::text$$;
 create function private.prepared_aggregate_mask_secondary(jsonb,text,text)returns jsonb language sql stable as $$select $1$$;
 create function private.prepared_aggregate_raw_kernel(q jsonb,t jsonb)returns jsonb language sql stable as $$select jsonb_build_object(
  'version',1,'startAt',q->'startAt','endAt',q->'endAt','successStartAt',q->'successStartAt','successEndAt',q->'successEndAt',
  'successBasis',q->'successBasis','durationVersion',q->'durationVersion','asOf',statement_timestamp(),
  'summary',jsonb_build_array(jsonb_build_object('direction','charge','all_count',(select count(*)from public.panda_order_details where direction='deposit'and created_at>=(q->>'startAt')::timestamptz and created_at<(q->>'endAt')::timestamptz),'success_count',null,'success_amount',null)),
  'capabilities','{}'::jsonb,'groups','{"provider":[]}'::jsonb,'rows','[]'::jsonb)$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version int);
 create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active bool);
 create table public.ar_config_targets(source_system text,country_code text,platform text,currency text);
 `);
 await db.exec(one('private.prepared_aggregate_compute(jsonb,jsonb)').replace('private.prepared_aggregate_compute','panda_private.baseline_compute'));
 await db.exec(source('compute'));
 await db.exec(one('private.prepared_aggregate_dependency(jsonb,text)').replace('private.prepared_aggregate_dependency','panda_private.baseline_dependency'));
 await db.exec(source('dependency'));
 for(const r of baseline.filter(x=>x.signature.startsWith('private.dashboard_prepared_')))await db.exec(r.definition);
 await db.exec("create function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language sql stable as $$select $3$$");
 await db.exec(one('private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)').replace('private.prepared_aggregate_master_projection','panda_private.baseline_master_projection'));
 await db.exec(source('projection'));
});
after(async()=>db?.close());
test('future request without verified prefix stays unavailable',()=>tx(async()=>{await assert.rejects(prefix(),/PANDA_COVERAGE_INCOMPLETE/);}));
test('unchanged strict verifier rejects full future request; prefix preserves original filters and real cutoff',()=>tx(async()=>{
 await row('deposit','charge-one',clock.middle);await row('reviewed_withdrawal','withdraw-one',clock.middle);
 for(const d of ['deposit','reviewed_withdrawal'])await receipt(d);
 const full=(await db.query('select private.dashboard_admin_panda_query_coverage($1,$2,$3,$4)r',['Synthetic','all',clock.start,clock.end])).rows[0].r;assert.equal(full.complete,false);
 const p=await prefix();assert.equal(p.clipped,true);assert.equal(p.requestedComplete,false);assert.equal(p.sourceComplete,false);assert.equal(p.effectiveComplete,true);assert.equal(Date.parse(p.dataCutoff),Date.parse(clock.cutoff));assert.equal(Date.parse(p.requestedEndAt),Date.parse(clock.end));assert.equal(p.effectiveCoverage.complete,true);
}));
test('all-direction population uses the common earlier verified cutoff',()=>tx(async()=>{
 await receipt('deposit',clock.start,clock.cutoff);await receipt('reviewed_withdrawal',clock.start,clock.middle);
 assert.equal(Date.parse((await prefix()).dataCutoff),Date.parse(clock.middle));
}));
test('receipt gaps never let a later segment cover the missing interval',()=>tx(async()=>{
 const gapEnd=new Date(Date.parse(clock.middle)+15*60*1000).toISOString();
 for(const d of ['deposit','reviewed_withdrawal']){await receipt(d,clock.start,clock.middle);await receipt(d,gapEnd,clock.cutoff);}
 assert.equal(Date.parse((await prefix()).dataCutoff),Date.parse(clock.middle));
}));
test('a segment starting after request start is not a prefix',()=>tx(async()=>{
 for(const d of ['deposit','reviewed_withdrawal'])await receipt(d,clock.middle,clock.cutoff);
 await assert.rejects(prefix(),/PANDA_COVERAGE_INCOMPLETE/);
}));
test('row-count proof cannot be replaced by receipt metadata',()=>tx(async()=>{
 await receipt('deposit',clock.start,clock.cutoff,{expected:1});await receipt('reviewed_withdrawal');
 await assert.rejects(prefix(),/PANDA_COVERAGE_INCOMPLETE/);
}));
test('member identity proof is still required',()=>tx(async()=>{
 await row('deposit','charge-one',clock.middle);const scan=await receipt('deposit');await receipt('reviewed_withdrawal');
 await db.query('update panda_private.order_scan_members set order_id=$1 where scan_id=$2',['wrong-identity',scan]);
 await assert.rejects(prefix(),/PANDA_COVERAGE_INCOMPLETE/);
}));
test('unverified and future-observed receipts cannot publish a prefix',()=>tx(async()=>{
 await receipt('deposit',clock.start,clock.cutoff,{verified:false});await receipt('reviewed_withdrawal',clock.start,clock.cutoff,{observed:clock.end});
 await assert.rejects(prefix(),/PANDA_COVERAGE_INCOMPLETE/);
}));
test('closed requests keep the exact existing raw-kernel path',()=>tx(async()=>{
 assert.deepEqual(await prefix('all',clock.start,clock.cutoff),{clipped:false});
}));
test('zero is allowed only inside an independently verified prefix',()=>tx(async()=>{
 for(const d of ['deposit','reviewed_withdrawal'])await receipt(d);
 const p=await prefix();assert.equal(p.requestedComplete,false);assert(p.effectiveCoverage.directions.every(x=>x.zeroConfirmed&&x.count===0));
}));
test('charge-only request needs no withdrawal receipt',()=>tx(async()=>{
 await receipt('deposit');assert.equal((await prefix('charge')).effectiveComplete,true);await assert.rejects(prefix('all'),/PANDA_COVERAGE_INCOMPLETE/);
}));
test('future-only start is rejected',()=>tx(async()=>{
 await assert.rejects(prefix('charge',clock.end,new Date(Date.parse(clock.end)+3600000).toISOString()),/PANDA_COVERAGE_INCOMPLETE/);
}));
test('new helper is not directly executable by API roles',async()=>{
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query(`select has_function_privilege($1,'panda_private.prepared_window(text,text,timestamptz,timestamptz)','EXECUTE')ok`,[role])).rows[0].ok,false);
});
const target=source=>({id:'11111111-1111-4111-8111-111111111111',name:'Synthetic',source,source_name:'Synthetic',scope_group:'BR',country:'巴西',currency:'BRL',timezone:'America/Sao_Paulo'});
const request=()=>({action:'aggregate',platformId:target('panda').id,view:'full',startAt:clock.start,endAt:clock.end,successStartAt:clock.start,successEndAt:clock.end,successBasis:'success',direction:'all',durationVersion:2});
const compute=async(name,q,t)=>(await db.query('select '+name+'($1,$2)r',[q,t])).rows[0].r;
const compareCompute=async(q,t)=>(await db.query('select private.prepared_aggregate_compute($1,$2)actual,panda_private.baseline_compute($1,$2)expected',[q,t])).rows[0];
test('non-Panda compute outputs remain identical for every supported source family',()=>tx(async()=>{
 for(const source of ['ar','newar','lg','wg','duoli','kb','game66']){const r=await compareCompute(request(),target(source));assert.deepEqual(r.actual,r.expected);}
}));
test('Panda compute excludes unverified later rows while echoing original independent windows',()=>tx(async()=>{
 await row('deposit','covered-row',clock.middle);await row('deposit','unverified-later',new Date(Date.parse(clock.cutoff)+15*60*1000).toISOString());
 for(const d of ['deposit','reviewed_withdrawal'])await receipt(d);
 const q=request(),r=await compute('private.prepared_aggregate_compute',q,target('panda'));
 assert.equal(r.summary[0].all_count,1);assert.equal(r.summary[0].success_count,null);assert.equal(r.endAt,q.endAt);assert.equal(r.successEndAt,q.successEndAt);
 assert.equal(r.pandaCoverage.complete,false);assert.equal(r.pandaCoverage.effectiveComplete,true);assert.equal(Date.parse(r.pandaCoverage.dataCutoff),Date.parse(clock.cutoff));
 assert.equal(r._preparedDirectionCapabilities.all.successTimeAvailable,false);
}));
test('closed Panda compute remains identical to baseline',()=>tx(async()=>{
 const q={...request(),endAt:clock.cutoff,successEndAt:clock.cutoff},r=await compareCompute(q,target('panda'));assert.deepEqual(r.actual,r.expected);
}));
test('future helper changes affect only Panda target token for unchanged common token',()=>tx(async()=>{
 const dep=async(source,fn='private.prepared_aggregate_dependency')=>(await db.query('select '+fn+'($1,$2)t',[target(source),'same-common-contract'])).rows[0].t;
 const ar=await dep('ar'),panda=await dep('panda');assert.equal(ar,await dep('ar','panda_private.baseline_dependency'));assert.notEqual(panda,await dep('panda','panda_private.baseline_dependency'));
 await db.exec('alter function panda_private.prepared_window(text,text,timestamptz,timestamptz)cost 101');
 assert.equal(await dep('ar'),ar);assert.notEqual(await dep('panda'),panda);
}));
test('prefix remains explicitly incomplete through full/providers and all/charge/withdraw production projections',()=>tx(async()=>{
 for(const d of ['deposit','reviewed_withdrawal'])await receipt(d);
 const b=request(),r=await compute('private.prepared_aggregate_compute',b,target('panda'));r.platform={...target('panda'),sourceName:'Synthetic',scopeGroup:'BR'};
 for(const view of ['full','providers'])for(const direction of ['all','charge','withdraw']){
  const q={...b,view,direction},out=(await db.query('select private.prepared_aggregate_master_projection($1,$2,$3)r',[r,b,q])).rows[0].r;
  assert.equal(out.pandaCoverage.complete,false,view+':'+direction);assert.equal(out.pandaCoverage.requestedComplete,false);assert.equal(out.pandaCoverage.effectiveComplete,true);
  assert.deepEqual(out.pandaCoverage.directions.map(x=>x.direction).sort(),direction==='all'?['charge','withdraw']:[direction]);
  assert.equal(Date.parse(out.pandaCoverage.dataCutoff),Date.parse(clock.cutoff));assert.equal(out.endAt,b.endAt);assert.equal(out.successEndAt,b.successEndAt);
 }
}));
test('closed Panda and non-Panda full/providers projections remain identical across all directions',()=>tx(async()=>{
 for(const source of ['panda','ar']){
  const b={...request(),endAt:clock.cutoff,successEndAt:clock.cutoff},r=await compute('private.prepared_aggregate_compute',b,target(source));r.platform={...target(source),sourceName:'Synthetic',scopeGroup:'BR'};
  if(source==='panda')r.pandaCoverage={complete:true,directions:['charge','withdraw'].map(direction=>({direction,startAt:b.startAt,endAt:b.endAt,complete:true}))};
  for(const view of ['full','providers'])for(const direction of ['all','charge','withdraw']){
   const q={...b,view,direction},pair=(await db.query('select private.prepared_aggregate_master_projection($1,$2,$3)a,panda_private.baseline_master_projection($1,$2,$3)b',[r,b,q])).rows[0];assert.deepEqual(pair.a,pair.b,source+':'+view+':'+direction);
  }
 }
}));

test('source-only migration is repeatable without changing current dependency tokens',()=>tx(async()=>{
 const before=await db.query("select private.prepared_aggregate_dependency($1,'same-common-contract')p,private.prepared_aggregate_dependency($2,'same-common-contract')a",[target('panda'),target('ar')]);
 await db.exec(migration);
 const after=await db.query("select private.prepared_aggregate_dependency($1,'same-common-contract')p,private.prepared_aggregate_dependency($2,'same-common-contract')a",[target('panda'),target('ar')]);
 assert.deepEqual(after.rows,before.rows);
 assert(!/CREATE(?: OR REPLACE)? FUNCTION private\.(?:prepared_aggregate_raw_kernel|dashboard_admin_panda_(?:range_evidence|query_coverage))\(/i.test(migration));
}));
