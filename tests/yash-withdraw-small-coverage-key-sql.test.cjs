const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {test}=require('node:test');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const baseline=read('tests/fixtures/yash-withdraw-small-coverage-baseline.sql'),migration=read('supabase/migrations/20261011111822_yash_withdraw_small_coverage_group_key.sql');
const newBody=migration.match(/new_body text:=\$new\$([\s\S]*?)\$new\$;/)[1],candidate=baseline.replace(baseline.split('$function$')[1],newBody);
const sig='private.dashboard_admin_yash_withdraw_days(jsonb,jsonb,date,date)';
const columns=['data_date','country','platform','platform_key','total','success','rejected','pending_count','failed_count','unknown_count','avg_seconds','duration_sample_count','duration_total_seconds','source_updated_at','updated_at','complete','operator_rows'];
const meta=async db=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
const call=async(db,q={},s={mode:'all'},a='2026-10-09',b='2026-10-11')=>(await db.query("select to_jsonb(x) r from private.dashboard_admin_yash_withdraw_days($1,$2,$3::date,$4::date)x order by data_date,country,platform_key",[{country:'印度',...q},s,a,b])).rows.map(x=>x.r);
test('YASH coverage flags preserve all 17 fields across 18 native/unknown/zero/large-evidence cases and fail closed on metadata drift',async()=>{const db=new PGlite();try{
 await db.exec(`create schema private;
 create table synthetic_catalog(name text,country text,source_name text,timezone text,source text,scope_group text);
 create function private.dashboard_admin_live_platforms() returns setof synthetic_catalog language sql stable as $$select * from public.synthetic_catalog$$;
 insert into synthetic_catalog values('YASH.BET','印度','YASH.BET','Asia/Kolkata','kb','IN');
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select regexp_replace(upper(btrim($1)),'[^A-Z0-9]','','g')$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->>'mode'='all' or (s->>'mode'='selected' and s->'countries' ? c and (not s?'platforms' or s->'platforms' @> jsonb_build_array(jsonb_build_object('country',c,'platform',p))))$$;
 create function private.dashboard_admin_yash_status(text,text) returns text language sql immutable as $$select case $2 when '提现成功' then 'success' when '已驳回' then 'rejected' when '已创建' then 'pending' when '提现失败' then 'failed' else 'unknown' end$$;
 create table private.yash_orders(source_site text,order_type text,order_no text,operator text,status text,created_at timestamptz,completed_at timestamptz,observed_at timestamptz,received_at timestamptz,raw_fields jsonb,primary key(order_type,order_no));
 create index on private.yash_orders(order_type,created_at);
 create table private.yash_sync_windows(order_type text,stream text,start_at timestamptz,end_exclusive timestamptz,source_count bigint,uploaded_count bigint,stored_count bigint,complete boolean,observed_at timestamptz,received_at timestamptz,source_timezone text,primary key(order_type,stream,start_at,end_exclusive));`);
 await db.exec(read('tests/fixtures/yash-withdraw-day-evidence-baseline.sql')+';');
 for(const day of ['2026-10-09','2026-10-10']){
  const examples=[['提现成功','Same account',10],['已驳回','Same account',20],['已创建','Other account',null],['提现失败','Other account',-1],['未知',null,0],['提现成功','  ',0],['提现成功','Other account','infinity'],['提现成功','Same account',100000]];
  for(let i=0;i<examples.length;i++){const[status,account,seconds]=examples[i];await db.query("insert into private.yash_orders values('yash','withdrawal',$1,$2,$3,($4::date::timestamp+interval '1 hour'+$5::int*interval '1 hour') at time zone 'Asia/Kolkata',case when $6::text='infinity' then 'infinity'::timestamptz when $6 is null then null else (($4::date::timestamp+interval '1 hour'+$5::int*interval '1 hour') at time zone 'Asia/Kolkata')+$6::numeric*interval '1 second' end,'2026-10-11T00:00:00Z','2026-10-11T00:01:00Z','{}')",[day+'-'+i,account,status,day,i,seconds]);}
 }
 await db.exec("insert into private.yash_orders values('OTHER','withdrawal','foreign-source','not-returned','提现成功','2026-10-09T01:00:00Z','2026-10-09T01:00:01Z','2026-10-11T00:00:00Z','2026-10-11T00:01:00Z','{}');insert into private.yash_orders values('yash','deposit','foreign-kind','not-returned','提现成功','2026-10-09T01:00:00Z','2026-10-09T01:00:01Z','2026-10-11T00:00:00Z','2026-10-11T00:01:00Z','{}')");
 const win=async(day,endHour,complete=true,wrongCount=false,stream='createTime')=>db.query("insert into private.yash_sync_windows select 'withdrawal',$4,$1::date::timestamp at time zone 'Asia/Kolkata',($1::date::timestamp+$2::int*interval '1 hour') at time zone 'Asia/Kolkata',count(*)+$5::int,count(*),count(*),$3,'2026-10-11T00:00:00Z','2026-10-11T00:02:00Z','UTC' from private.yash_orders where source_site='yash' and order_type='withdrawal' and created_at>=$1::date::timestamp at time zone 'Asia/Kolkata' and created_at<($1::date::timestamp+$2::int*interval '1 hour') at time zone 'Asia/Kolkata'",[day,endHour,complete,stream,wrongCount?1:0]);
 await win('2026-10-09',24);await win('2026-10-10',12);await win('2026-10-10',24,true,true);await win('2026-10-10',24,true,false,'completeTime');
 const cases=[{},{q:{platforms:[]}},{q:{platform:'YASH.BET'}},{q:{platform:'OTHER'}},{q:{country:'巴西'}},{q:{scopeTargets:[{country:'印度',platforms:['YASH.BET']}]}},{q:{scopeTargets:[{country:'印度',platforms:[]}]}},{s:{mode:'selected',countries:['印度'],platforms:[]}},{s:{mode:'selected',countries:[]}},{s:{mode:'selected',countries:['印度'],platforms:[{country:'印度',platform:'YASH.BET'}]}},{a:'2026-10-09',b:'2026-10-09'},{a:'2026-10-10',b:'2026-10-10'},{a:'2026-10-08',b:'2026-10-08'},{a:'2099-01-01',b:'2099-01-01'}];
 await db.exec(baseline);const before=await meta(db),expected=[];assert.equal(before.hash,'3a9751fdc8c61a3df1bd0776c9a5d352');
 for(const c of cases)expected.push(await call(db,c.q,c.s,c.a,c.b));
 assert.deepEqual(Object.keys(expected[0][0]).sort(),columns.slice().sort());assert.equal(expected[0][0].complete,true);assert.equal(expected[0][1].complete,false);assert.equal(expected[0][2].total,null);assert.equal(expected[0][0].duration_sample_count,3);assert.equal(expected[0][0].duration_total_seconds,100010);
 await db.exec(candidate);const after=await meta(db);assert.deepEqual(after.metadata,before.metadata);
 for(let i=0;i<cases.length;i++){const c=cases[i];assert.deepEqual(await call(db,c.q,c.s,c.a,c.b),expected[i],`source full JSON ${i}`);}
 const evidenceVariants=[{}, {complete:null,seen:null,progress:[]}, {complete:false,seen:null,progress:[]}, {complete:true,seen:'2026-10-11T00:02:00Z',progress:Array.from({length:1000},(_,i)=>({stream:'createTime',syntheticIndex:i,receivedAt:'2026-10-11T00:02:00Z'}))}];
 for(const e of evidenceVariants){
  const ddl=(await db.query("select format('create or replace function private.dashboard_admin_yash_day_evidence(p_country text,p_platform text,p_kind text,p_day date) returns jsonb language sql stable set search_path='''' as %L', 'select '||quote_literal($1::jsonb::text)||'::jsonb') ddl",[JSON.stringify(e)])).rows[0].ddl;await db.exec(ddl);
 await db.exec(baseline);const old=await call(db);await db.exec(candidate);assert.deepEqual(await call(db),old,'missing/null/large evidence preserves wire');}
 await db.exec(baseline);await db.exec(`revoke all on function ${sig} from public`);const guardBefore=await meta(db);
 await db.exec(migration);const guardAfter=await meta(db);assert.deepEqual(guardAfter.metadata,guardBefore.metadata);assert.equal(guardAfter.hash,'1e9eda16514b65889295810e6bf1d742');
 await db.exec(migration);assert.deepEqual(await meta(db),guardAfter,'guard replay');
 const block=migration.slice(migration.indexOf('do $patch$'),migration.indexOf('\ncommit;'));
 for(const drift of [`alter function ${sig} security definer`,`alter function ${sig} set search_path=public`,`grant execute on function ${sig} to public`,`alter function ${sig} volatile`,`alter function ${sig} parallel safe`]){
  await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/YASH_COVERAGE_KEY_METADATA_MISMATCH/);await db.exec('rollback');assert.deepEqual(await meta(db),guardAfter);
 }
 await db.exec('begin');await db.exec(baseline.replace(' with sites as materialized (',' -- unreviewed drift\n with sites as materialized ('));await assert.rejects(()=>db.exec(block),/YASH_COVERAGE_KEY_BODY_MISMATCH/);await db.exec('rollback');
 await db.exec('begin');await db.exec(`drop function ${sig}`);await db.exec(baseline.replace('TABLE(data_date date,','TABLE(source_date date,'));await db.exec(`revoke all on function ${sig} from public`);assert.equal((await meta(db)).hash,guardBefore.hash);await assert.rejects(()=>db.exec(block),/YASH_COVERAGE_KEY_METADATA_MISMATCH/);await db.exec('rollback');assert.deepEqual(await meta(db),guardAfter);
 }finally{await db.close();}});
