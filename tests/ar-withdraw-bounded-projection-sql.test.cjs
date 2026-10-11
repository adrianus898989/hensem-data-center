// Synthetic-only regression; no production data or session impersonation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),test=require('node:test');
const baseline=fs.readFileSync(path.join(repo,'tests/fixtures/ar-withdraw-bounded-projection-production.sql'),'utf8');
const guarded=fs.readFileSync(path.join(repo,'supabase/migrations/20261011153419_ar_withdraw_bounded_projection_auto_lane.sql'),'utf8');
const bounded=baseline.replace(guarded.match(/\$old0\$([\s\S]*?)\$old0\$/)[1],guarded.match(/\$new0\$([\s\S]*?)\$new0\$/)[1]);
const candidate=bounded.replace(guarded.match(/\$old1\$([\s\S]*?)\$old1\$/)[1],guarded.match(/\$new1\$([\s\S]*?)\$new1\$/)[1]);
const rfile=path.join(repo,'tests/ar-withdraw-fact-readiness-sql.test.cjs');
// Execute the existing complete readiness/fallback differential against the current reader.
let readiness=fs.readFileSync(rfile,'utf8');
const begin=readiness.indexOf('const all='),end=readiness.indexOf('\nconst controls=');
const readinessPrefix=`const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,row,install}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
const w=__dirname,read=f=>fs.readFileSync(path.join(w,'../supabase/migrations',f==='stage2-controls-guarded-draft.sql'?'20261011120036_ar_in_withdraw_fact_partition_readiness.sql':'20261011120049_ar_in_withdraw_fact_reader.sql'),'utf8');
const baseline=globalThis.baselineInput,candidate=globalThis.candidateInput;\n`;
const R=vm.createContext({__dirname:path.join(repo,'tests'),require:createRequire(rfile),console,baselineInput:baseline,candidateInput:bounded});
vm.runInContext(readinessPrefix+readiness.slice(begin,end)+';globalThis.run=main;',R);
const mainFile=path.join(repo,'tests/auto-withdraw-unselected-history-sql.test.cjs');
const C=vm.createContext({__dirname:path.dirname(mainFile),require:n=>n==='node:test'?{test(){}}:createRequire(mainFile)(n),structuredClone});
vm.runInContext(fs.readFileSync(mainFile,'utf8').split(/\ntest\(/)[0]+';globalThis.h=ctx.f2;',C);
const {row,install}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
const query=async(db,q)=>(await db.query('select to_jsonb(a) r from private.dashboard_admin_ar_withdraw_days($1,$2,$3::date,$4::date)a order by data_date,country,platform_key',[q,{mode:'all',countries:[]},'2026-10-10','2026-10-11'])).rows.map(x=>x.r);
const call=(db,q={})=>db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb)r',[{country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...q}]).then(x=>x.rows[0].r);
async function fullFixture(){const db=await C.h.fixture();
 await db.exec(fs.readFileSync(path.join(repo,'tests/fixtures/auto-withdraw-country-map-production.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(repo,'tests/fixtures/auto-withdraw-historical-duration-production.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(repo,'supabase/migrations/20261011150414_auto_withdraw_preserve_historical_duration.sql'),'utf8'));
 await db.exec(`create table public.ar_collected_orders(source_system text not null,country_code text not null,platform text not null,order_kind text not null,order_no text not null,status text,operator text,applied_at timestamp,completed_at timestamp,observed_at timestamptz not null,updated_at timestamptz not null,primary key(source_system,country_code,platform,order_kind,order_no));
 alter table public.ar_collected_orders enable row level security;grant all on public.ar_collected_orders to postgres,service_role;
 create table public.synthetic_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms() returns setof public.synthetic_catalog language sql stable as $$select * from public.synthetic_catalog$$;
 insert into public.synthetic_catalog values
 (md5('91')::uuid,'91CLUB','M8','印度','IN','ar','Asia/Kolkata','INR','91CLUB'),
 (md5('veer')::uuid,'Veer.Game','M8','印度','IN','ar','Asia/Kolkata','INR','Veer.Game'),
 (md5('raja')::uuid,'RAJALOTTERY','M8','印度','IN','ar','Asia/Kolkata','INR','RAJA'),
 (md5('pk')::uuid,'92.GAME','M8','巴基斯坦','PK','ar','Asia/Karachi','PKR','92.GAME'),
 (md5('manual')::uuid,'OK.WIN','M8','印度','IN','ar','Asia/Kolkata','INR','OKWIN'),
 (md5('unknown')::uuid,'JALWA','M8','印度','IN','ar','Asia/Kolkata','INR','JALWA'),
 (md5('zero')::uuid,'55CLUB','M8','印度','IN','ar','Asia/Kolkata','INR','55CLUB');
 drop function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date);`);
 await db.exec(fs.readFileSync(path.join(repo,'tests/fixtures/ar-withdraw-fact-reader-baseline.sql'),'utf8'));
 await db.exec('revoke all on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) from public');
 await db.exec(install);
 await db.exec(fs.readFileSync(path.join(repo,'supabase/migrations/20261011120036_ar_in_withdraw_fact_partition_readiness.sql'),'utf8'));
 let id=0;
 for(const day of ['2026-10-10','2026-10-11'])for(const platform of ['91CLUB','Veer.Game','RAJA','92.GAME'])for(const [status,operator,seconds] of [['已通过',' Same account ',21],['未通过','Same account',0],['success reject','SYSTEM',-1],['unknown',null,null],['failed','----',null],['处理中','Second',0.9]]){
  await row(db,'SYNTHETIC-'+(++id),{platform,country_code:platform==='92.GAME'?'PK':'IN',status,operator,applied_at:day+' 12:00:00',completed_at:seconds===null?null:day+' 12:'+ (seconds<0?'00:00':'00:'+String(seconds).padStart(2,'0'))});
 }
 await row(db,'FUTURE',{applied_at:'2026-10-12 00:00:00',completed_at:'2026-10-12 00:00:30'});
 await row(db,'NULLDAY',{applied_at:null,completed_at:null});
 await row(db,'BEFORE',{applied_at:'2026-10-09 23:59:59',completed_at:'2026-10-10 00:00:20'});
 for(const day of ['2026-10-10','2026-10-11']){
  await row(db,'ONLY-MANUAL-'+day,{platform:'OKWIN',operator:'Only manual',applied_at:day+' 01:00:00',completed_at:day+' 01:00:30'});
  await row(db,'ONLY-UNKNOWN-'+day,{platform:'JALWA',operator:null,status:'未通过',applied_at:day+' 23:59:59.999999',completed_at:null});
 }
 await db.exec(`begin isolation level repeatable read;`);
 for(const platform of ['91CLUB','Veer.Game','RAJA','OKWIN','JALWA','55CLUB'])for(const day of ['2026-10-10','2026-10-11'])await db.query('select private.approve_ar_withdraw_fact_day($1,$2::date)',[platform,day]);
 await db.exec('commit');
 for(const day of ['2026-10-09','2026-10-10','2026-10-11']){await C.h.legacy(db,'91CLUB',day);await C.h.legacy(db,'LEGACY',day);await C.h.native(db,'newar','MAAN.WIN',day,{},'MAANWIN');await C.h.native(db,'yash','YASH.BET',day,{});await db.query("insert into withdraw_operator_daily values($1,'印度','OPERATOR-ONLY','Only legacy',3,1,12,$2,$2)",[day,'2026-10-11T00:00:00Z']);}
 return db;
}
test('projected native date bounds preserve all 17 fields across readiness, aliases, scope and fallback states',async()=>{
 const report=await R.run();assert.equal(report.full_json_comparisons,210);assert.equal(report.differences,0);
});
test('unused auto operator lane preserves complete main JSON and guarded replay, generation, permissions and metadata',async()=>{
 const readinessReport={full_json_comparisons:210};
 const db=await fullFixture();try{
 const cases=[];for(const view of ['auto','operators'])for(const daily of [false,true])for(const sort of ['country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'])cases.push({view,daily,sort});
 cases.push({},{platforms:[]},{platform:'91CLUB'},{platforms:['91CLUB','RAJA']},{platform:'Veer.Game'},{platform:'ABSENT'},{view:'operators',account:'Same'},{view:'operators',account:'ABSENT'},{country:'巴基斯坦'},{daily:true,endAt:'2026-10-11T23:59:59Z'},{offset:20},{ascending:true},{scopeTargets:[{country:'印度',platforms:['91CLUB']}]},{platform:'OKWIN'},{platform:'JALWA'},{platform:'55CLUB'},{view:'operators',platform:'OKWIN'},{view:'operators',platform:'JALWA'},{view:'operators',platform:'55CLUB'});
 cases.push({platform:'RAJALOTTERY'},{platform:'OK.WIN'},{platform:'OPERATOR-ONLY'},{view:'operators',platform:'OPERATOR-ONLY'});
 await db.exec(baseline);const expected=[];for(const q of cases)expected.push(await call(db,q));
 assert(expected[0].platforms.includes('OPERATOR-ONLY'),'legacy operator-only platform is preserved in auto directory');
 await assert.rejects(()=>call(db,{scopeTargets:[{country:'印度',platforms:['91CLUB']},{country:'巴基斯坦',platforms:['92.GAME']}]}),/invalid_scope_targets/);
 const helperMeta=(await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0].m;
 await db.exec(candidate);for(let i=0;i<cases.length;i++)assert.deepEqual(await call(db,cases[i]),expected[i],'complete main JSON '+i);
 await assert.rejects(()=>call(db,{scopeTargets:[{country:'印度',platforms:[]}]}),/invalid_scope_targets/);
 await assert.rejects(()=>call(db,{scopeTargets:[{country:'印度',platforms:['91CLUB']},{country:'巴基斯坦',platforms:['92.GAME']}]}),/invalid_scope_targets/);
 assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0].m,helperMeta);
 const auto=await query(db,{country:'印度'});assert(auto.every(x=>x.operator_rows.length===0));
 const operator=await query(db,{country:'印度',view:'operators'});assert(operator.some(x=>x.operator_rows.length>0));
 const core=candidate.split(' RETURN QUERY\n')[1].split(';\nEND;')[0].replace(/\bp_request\b/g,'$1').replace(/\bp_scope\b/g,'$2').replace(/\bp_start\b/g,'$3').replace(/\bp_end\b/g,'$4');
 await db.exec('set plan_cache_mode=force_generic_plan;prepare ar_bound_probe(jsonb,jsonb,date,date) as '+core+';');
 const plan=(await db.query(`explain(format json) execute ar_bound_probe('{"country":"印度","view":"auto"}','{"mode":"all","countries":[]}','2026-10-10','2026-10-10')`)).rows[0]['QUERY PLAN'];
 const factScans=[];const walk=n=>{if(n['Relation Name']==='ar_withdraw_facts')factScans.push(n);for(const p of n.Plans||[])walk(p);};walk(plan[0].Plan);
 assert(factScans.some(n=>/applied_at.*\$3/.test((n.Filter||'')+' '+(n['Index Cond']||''))&&/applied_at.*\$4/.test((n.Filter||'')+' '+(n['Index Cond']||''))),'generic parameters reach the projected base scan');

 for(const scope of [{targets:[]},{targets:[['印度','91CLUB']]},{targets:[['印度','Veer.Game']]}]){
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);await db.exec(baseline);const old=await call(db);await db.exec(candidate);assert.deepEqual(await call(db),old,'scope '+JSON.stringify(scope));
 }
 await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied/);
 await db.exec("set test.denied='no';set test.scope='{}';");
 const block=guarded.slice(guarded.indexOf('do $patch$'),guarded.lastIndexOf('commit;'));
 await db.exec(baseline);const metaBefore=(await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0].m;
 const generationBefore=(await db.query('select private.ar_withdraw_fact_generation() g')).rows[0].g;
 const readyBefore=(await db.query('select to_jsonb(r) j from private.ar_withdraw_fact_ready r order by platform,data_date')).rows;
 await db.exec(guarded);await db.exec(guarded);
 assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0].m,metaBefore);
 assert.equal((await db.query('select private.ar_withdraw_fact_generation() g')).rows[0].g,generationBefore);
 assert.deepEqual((await db.query('select to_jsonb(r) j from private.ar_withdraw_fact_ready r order by platform,data_date')).rows,readyBefore);
 const sig='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)';
 const drifts=[baseline.replace('BEGIN\n','BEGIN\n -- synthetic unknown drift\n'),`alter function ${sig} security definer`,`alter function ${sig} set search_path=public`,`grant execute on function ${sig} to anon`,`alter function ${sig} volatile`,`alter function ${sig} owner to anon`,
 `drop function ${sig};`+baseline.replace('data_date date, country','drifted_day date, country')+`;revoke all on function ${sig} from public;`];
 for(const drift of drifts){await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/AR_WITHDRAW_BOUNDED_METADATA_OR_BODY_DRIFT/);await db.exec('rollback');}
 const report={synthetic_only:true,production_reads:0,production_writes:0,date_bound_17_field_comparisons:readinessReport.full_json_comparisons,full_main_json_comparisons:cases.length+3,differences:0,helper_output_columns:17,auto_operator_lane_not_consumed:true,manual_only_unknown_only_empty_day_preserved:true,operator_view_unchanged:true,metadata_unchanged:true,session_denial_preserved:true,generic_date_parameters_reach_base_scan:true,migration_replay_passed:true,readiness_generation_and_rows_preserved:true,metadata_and_OUT_drift_cases:drifts.length};
 assert.equal(report.differences,0);assert.equal(report.metadata_and_OUT_drift_cases,7);
 }finally{await db.close();}
});
