// Pure synthetic full-output differential test. No network or production data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const baseline=fs.readFileSync(path.join(root,'tests/fixtures/ar-withdraw-days-operator-baseline.sql'),'utf8');
const candidate=fs.readFileSync(path.join(root,'tests/fixtures/ar-withdraw-days-operator-candidate.sql'),'utf8');
const columns=['data_date','country','platform','platform_key','total','success','rejected','auto_count','manual_count','avg_seconds','duration_sample_count','duration_total_seconds','source_updated_at','updated_at','complete','operator_rows','alias_keys'];
const metadata=async db=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' meta from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0];
const scope={mode:'all',countries:[]};
const query=async(db,q,s=scope,start='2026-10-09',end='2026-10-12')=>(await db.query("select to_jsonb(a) r from private.dashboard_admin_ar_withdraw_days($1,$2,$3::date,$4::date)a order by data_date,country,platform_key",[q,s,start,end])).rows.map(x=>x.r);
async function main(){
 const db=new PGlite();try{
  await db.exec(`create schema private;
   create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,status text,operator text,applied_at timestamp,completed_at timestamp,observed_at timestamptz,updated_at timestamptz);
   create table public.synthetic_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
   create function private.dashboard_admin_live_platforms() returns setof public.synthetic_catalog language sql stable as $$select * from public.synthetic_catalog$$;
   create function private.dashboard_admin_live_withdraw_key(p text) returns text language sql immutable as $$select case regexp_replace(upper(btrim(p)),'[^A-Z0-9]','','g') when 'RAJALOTTERY' then 'RAJA' else regexp_replace(upper(btrim(p)),'[^A-Z0-9]','','g') end$$;
   create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->>'mode'='all' or (s->>'mode'='selected' and (s->'countries' ? c or s->'countries' ? case c when '印度' then 'IN' when '巴基斯坦' then 'PK' end) and (not s?'platforms' or exists(select 1 from jsonb_array_elements(s->'platforms')x where x->>'country'=case c when '印度' then 'IN' when '巴基斯坦' then 'PK' else c end and private.dashboard_admin_live_withdraw_key(x->>'platform')=private.dashboard_admin_live_withdraw_key(p))))$$;
   insert into public.synthetic_catalog values
   (md5('91')::uuid,'91CLUB','M8','印度','IN','ar','Asia/Kolkata','INR','91CLUB'),
   (md5('ok')::uuid,'OK.WIN','M8','印度','IN','ar','Asia/Kolkata','INR','OKWIN'),
   (md5('veer')::uuid,'Veer.Game','M8','印度','IN','ar','Asia/Kolkata','INR','Veer.Game'),
   (md5('raja')::uuid,'RAJALOTTERY','M8','印度','IN','ar','Asia/Kolkata','INR','RAJA'),
   (md5('pk')::uuid,'92.GAME','M8','巴基斯坦','PK','ar','Asia/Karachi','PKR','92.GAME');`);
  const rows=[
   ['91CLUB','已通过',' Same account ','2026-10-10 00:00:00','2026-10-10 00:00:20'],
   ['91CLUB','已提交','Same account','2026-10-10 10:00:00','2026-10-10 10:00:05'],
   ['91CLUB','未通过','Same account','2026-10-10 11:00:00','2026-10-10 11:00:00'],
   ['91CLUB','success reject','System','2026-10-10 12:00:00','2026-10-10 11:59:59'],
   ['91CLUB','unknown','\u200b\ufeff\u00a0---\u3000','2026-10-10 13:00:00',null],
   ['91CLUB','failed','\n系统管理员\t','2026-10-10 14:00:00','2026-10-10 14:00:00.999'],
   ['91CLUB',null,null,'2026-10-10 15:00:00','2026-10-10 15:00:02'],
   ['91CLUB','驳回','Same account','2026-10-11 00:00:00','2026-10-11 00:00:10'],
   ['91CLUB','success','Other account','2026-10-09 23:59:59','2026-10-10 00:00:02'],
   ['91CLUB','success','Other account',null,null],
   ['OKWIN','成功','Same account','2026-10-10 01:00:00','2026-10-10 01:00:07'],
   ['OK.WIN','已提交','Same account','2026-10-10 02:00:00','2026-10-10 02:00:08'],
   ['RAJA','rejected','\tOperator\u202f','2026-10-10 03:00:00','2026-10-10 03:01:00'],
   ['RAJALOTTERY','unknown','----','2026-10-10 04:00:00',null],
   ['Veer.Game','submitted','system_automatic','2026-10-10 05:00:00','2026-10-10 05:00:05'],
   ['92.GAME','成功','Same account','2026-10-10 07:00:00','2026-10-10 07:00:30']
  ];
  for(let i=0;i<rows.length;i++){const [platform,status,operator,at,done]=rows[i];await db.query("insert into ar_collected_orders values('AR',$1,$2,'withdraw',$3,$4,$5,$6,$7,'2026-10-12T10:00:00Z','2026-10-12T10:00:01Z')",[platform==='92.GAME'?'PK':'IN',platform,'SYNTHETIC-'+i,status,operator,at,done]);}
  // Foreign direction/source/country/platform and both range edges must not leak.
  await db.exec(`insert into ar_collected_orders select 'OTHER',country_code,platform,order_kind,'foreign-source',status,operator,applied_at,completed_at,observed_at,updated_at from ar_collected_orders limit 1;
   insert into ar_collected_orders select source_system,country_code,platform,'recharge','foreign-kind',status,operator,applied_at,completed_at,observed_at,updated_at from ar_collected_orders limit 1;
   insert into ar_collected_orders select source_system,'PK',platform,order_kind,'foreign-country',status,operator,applied_at,completed_at,observed_at,updated_at from ar_collected_orders limit 1;
   insert into ar_collected_orders select source_system,country_code,'FOREIGN',order_kind,'foreign-platform',status,operator,applied_at,completed_at,observed_at,updated_at from ar_collected_orders limit 1;`);
  const requests=[
   {country:'印度'}, {country:'印度',platforms:[]}, {country:'印度',platforms:['91CLUB','OK.WIN']},
   {country:'印度',platform:'RAJALOTTERY'}, {country:'印度',platform:'91CLUB'},
   {country:'印度',platforms:['Veer.Game']}, {country:'印度',platforms:['ABSENT']},
   {country:'巴基斯坦'}, {country:'印度',view:'operators'},
   {country:'印度',scopeTargets:[{country:'印度',platforms:['91CLUB']},{country:'巴基斯坦',platforms:['92.GAME']}]},
  ];
  const cases=requests.map(q=>({q}));
  for(const q of requests.slice(0,5))cases.push({q,start:'2026-10-10',end:'2026-10-10'});
  cases.push({q:{country:'印度'},s:{mode:'selected',countries:['PK']}},
   {q:{country:'印度'},s:{mode:'selected',countries:['IN'],platforms:[]}},
   {q:{country:'印度'},s:{mode:'selected',countries:['IN'],platforms:[{country:'IN',platform:'91CLUB'}]}},
   {q:{country:'印度'},start:'2026-10-09',end:'2026-10-09'},
   {q:{country:'印度'},start:'2026-10-12',end:'2026-10-12'});
  await db.exec('begin isolation level repeatable read');await db.exec(baseline);
  const before=await metadata(db),expected=[];assert.equal(before.hash,'14b0405ae25a71127cf04429c29b0d5c');
  for(const c of cases)expected.push(await query(db,c.q,c.s,c.start,c.end));
  for(const r of expected[0])assert.deepEqual(Object.keys(r).sort(),columns.slice().sort());
  const a=expected[0].find(r=>r.platform_key==='91CLUB'&&r.data_date==='2026-10-10');
  assert.equal(a.total,7);assert.equal(a.success,3);assert.equal(a.rejected,2);assert.equal(a.auto_count,1);assert.equal(a.manual_count,4);
  assert.equal(a.duration_sample_count,3);assert.equal(a.duration_total_seconds,27);
  assert.equal(a.operator_rows.find(r=>r.account==='Same account').processed,3);
  assert.equal(a.operator_rows.find(r=>r.account==='Same account').rejected,1);
  assert.equal(a.operator_rows.find(r=>r.account==='Same account').success,2);
  assert.equal(expected[0].find(r=>r.platform_key==='91CLUB'&&r.data_date==='2026-10-12').total,null);
  assert.deepEqual(expected[1],[],'preserve existing explicit-empty request behavior');
  assert.deepEqual(expected[15],[]);assert.deepEqual(expected[16],[]);assert.deepEqual(expected[18],[]);
  await db.exec(candidate);const after=await metadata(db);assert.deepEqual(after.meta,before.meta);
  for(let i=0;i<cases.length;i++){const c=cases[i];assert.deepEqual(await query(db,c.q,c.s,c.start,c.end),expected[i],`17-column full JSON difference at ${i}`);}
  await db.exec('rollback');
  const guarded=fs.readFileSync(path.join(root,'supabase/migrations/20261011102535_ar_withdraw_report_single_operator_pass.sql'),'utf8');
  await db.exec(baseline);await db.exec('revoke all on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) from public');
  const guardBefore=await metadata(db);await db.exec(guarded);const guardAfter=await metadata(db);
  assert.deepEqual(guardBefore.meta,guardAfter.meta);assert.equal(guardAfter.hash,after.hash);
  for(let i=0;i<cases.length;i++){const c=cases[i];assert.deepEqual(await query(db,c.q,c.s,c.start,c.end),expected[i]);}
  await db.exec(guarded);assert.deepEqual(await metadata(db),guardAfter,'replay must preserve all metadata');
  let rejectedDrifts=0;
  for(const drift of [
   'alter function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) security definer',
   "alter function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) set search_path='public'",
   'grant execute on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) to public',
   'alter function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) volatile'
  ]){
   await db.exec('begin');await db.exec(drift);
   // Test the DO inside this transaction, so a rejection cannot leave changed metadata.
   const block=guarded.slice(guarded.indexOf('do $patch$'),guarded.indexOf('\ncommit;'));
   await assert.rejects(()=>db.exec(block),/AR_WITHDRAW_OPERATOR_METADATA_MISMATCH/);await db.exec('rollback');rejectedDrifts++;
  }
  assert.deepEqual(await metadata(db),guardAfter);
  // Same body hash alone cannot identify the OUT wire contract. A recreated
  // function with one renamed OUT column must be rejected before replacement.
  await db.exec('begin');
  await db.exec('drop function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)');
  await db.exec(baseline.replace('TABLE(data_date date,','TABLE(source_date date,'));
  await db.exec('revoke all on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) from public');
  assert.equal((await metadata(db)).hash,before.hash);
  await assert.rejects(()=>db.exec(guarded.slice(guarded.indexOf('do $patch$'),guarded.indexOf('\ncommit;'))),/AR_WITHDRAW_OPERATOR_METADATA_MISMATCH/);
  await db.exec('rollback');assert.deepEqual(await metadata(db),guardAfter);rejectedDrifts++;
  const report={synthetic_only:true,production_calls:0,requests:cases.length,columns:17,full_json_differences:0,metadata_equal:true,baseline_hash:before.hash,candidate_hash:after.hash,guarded_replays:2,metadata_drift_rejections:rejectedDrifts,out_column_drift_rejected:true};
  console.log(JSON.stringify(report));
 }finally{await db.close();}
}
require('node:test').test('AR operator-once preserves all 17 fields for 20 synthetic requests, metadata, replay and drift gates',main);
