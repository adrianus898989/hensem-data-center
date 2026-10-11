// Pure local full-JSON differential; no session impersonation or production data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),source=path.join(__dirname,'ar-withdraw-previous-basis-sql.test.cjs');
const {test}=require('node:test');
const ctx=vm.createContext({__dirname:path.join(repo,'tests'),require:n=>n==='node:test'?{test:()=>{}}:createRequire(source)(n),structuredClone});
vm.runInContext(fs.readFileSync(source,'utf8').split(/\ntest\(/)[0]+'\nglobalThis.f2={fixture,ar,native:ctx.f.native,legacy:ctx.f.legacy,meta:ctx.f.meta};',ctx);
let baseline;const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const candidate=read('supabase/migrations/20261011122104_auto_withdraw_skip_unselected_history.sql');
const sig='private.dashboard_admin_live_auto_withdraw(jsonb)';
const request=e=>({country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...e});
const call=async(db,q)=>(await db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb) r',[request(q)])).rows[0].r;
test('skip unrelated history without changing full source, permission, operator or previous JSON in 83 cases',async()=>{const db=await ctx.f2.fixture();try{
 await db.exec("create function private.dashboard_admin_live_is_panghu_platform(text) returns boolean language sql immutable set search_path='' as $$select $1='25RR'$$");
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/withdraw-report-country-pruning-baseline.sql'),'utf8')+';');
 await db.exec(read('supabase/migrations/20261011104320_ar_withdraw_keep_reported_previous.sql'));
 await db.exec(read('supabase/migrations/20261011115024_auto_withdraw_keep_observed_newar_yash_previous.sql'));
 baseline=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[sig])).rows[0].definition;
 const op=(account,processed,rejected,avg_seconds=null)=>({account,processed,rejected,success:processed-rejected,avg_seconds,duration_sample_count:avg_seconds==null?0:processed,duration_total_seconds:avg_seconds==null?null:processed*avg_seconds,source_updated_at:'2026-10-11T00:00:00Z',updated_at:'2026-10-11T00:00:00Z'});
 for(const date of ['2026-10-09','2026-10-10','2026-10-11']){
  await ctx.f2.ar(db,'91CLUB',date,{operator_rows:[op('Same account',7,2,2),op('Other account',10,0,null)]});
  await ctx.f2.ar(db,'OK.WIN',date,{alias_keys:['OKWIN'],operator_rows:[op('Same account',4,1,0)]});
  await ctx.f2.legacy(db,'LEGACY',date,20,5,15);
  await ctx.f2.legacy(db,'91CLUB',date,999,499,500);
  await ctx.f2.native(db,'newar','MAAN.WIN',date,{operator_rows:[op('Same account',5,1,10)],currencies:['INR']},'MAANWIN');
  await ctx.f2.native(db,'yash','YASH.BET',date,{operator_rows:[op('Same account',3,0,2)]});
  await ctx.f2.native(db,'wg','WG-NATIVE',date,{operator_rows:[op('Other account',4,1,null)]});
  await db.query("insert into withdraw_operator_daily values($1,'印度','OPERATOR-ONLY','Same account',8,3,4,$2,$2)",[date,'2026-10-11T00:00:00Z']);
  await db.query("insert into withdraw_operator_daily values($1,'印度','LEGACY','Same account',15,0,12,$2,$2)",[date,'2026-10-11T00:00:00Z']);
  await db.query("insert into withdraw_operator_daily values($1,'印度','LEGACY','Other account',0,0,null,$2,$2)",[date,'2026-10-11T00:00:01Z']);
  await db.query("insert into newar_business_snapshots values('auto_withdraw_bundle','all','印度','DIRECT',$1,$2::jsonb,$3,$3)",[date,JSON.stringify({rows:[{total_count:4,success_count:3,reject_count:1,auto_count:1,manual_count:3,total_handle_seconds:0,handle_count:0}],operator_rows:[{operator:'Same account',processed_count:3,reject_count:1,total_handle_seconds:0,handle_count:0}]}),'2026-10-11T00:00:00Z']);
 }
 await ctx.f2.ar(db,'ZERO','2026-10-10',{total:0,success:0,auto_count:0,manual_count:0,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null});
 await ctx.f2.legacy(db,'ZERO','2026-10-09',0,0,0);
 await ctx.f2.legacy(db,'ABSENT-CURRENT','2026-10-09');
 await ctx.f2.legacy(db,'NO-PRIOR','2026-10-10');
 await ctx.f2.legacy(db,'BR-ONLY','2026-10-10',20,2,18,'BR');
 await ctx.f2.legacy(db,'PANGHU-ONLY','2026-10-10',10,1,9,'胖虎巴西');
 await ctx.f2.legacy(db,'PANGHU-ONLY','2026-10-10',77,1,76,'BR');
 await db.exec("insert into auto_withdraw_notes values('2026-10-10','印度','LEGACY','synthetic-only-note','2026-10-11T00:00:00Z')");
 const cases=[];
 for(const view of ['auto','operators'])for(const daily of [false,true])for(const sort of ['country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'])cases.push({q:{view,daily,sort}});
 for(const q of [{platforms:[]},{platforms:['91CLUB','OKWIN']},{platform:'MAAN.WIN'},{view:'operators',account:'Same'}, {view:'operators',account:'absent'}, {startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-11T23:59:59Z'}, {country:'巴西'}, {country:'胖虎巴西'}, {offset:20}, {ascending:true}, {scopeTargets:[{country:'印度',platforms:['91CLUB','OPERATOR-ONLY']}]}, {platform:'OPERATOR-ONLY'},{platform:'ABSENT'}])cases.push({q});
 for(const s of [{targets:[]},{targets:[['印度','91CLUB']]},{targets:[['印度','LEGACY']]}])cases.push({q:{},s});
 const old=await ctx.f2.meta(db,sig),expected=[];
 assert.equal(old.hash,'ff95fdfb022b8c4e6696697829372a19');
 for(const c of cases){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(c.s||{})]);expected.push(await call(db,c.q));}
 assert(expected[0].platforms.includes('OPERATOR-ONLY'),'auto directory retains operator-only native platform');
 await db.exec(candidate);const after=await ctx.f2.meta(db,sig);assert.deepEqual(after.metadata,old.metadata);
 for(let i=0;i<cases.length;i++){const c=cases[i];await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(c.s||{})]);assert.deepEqual(await call(db,c.q),expected[i],`full JSON at case ${i}`);}
 // A future shared mapping change must take the original all-history path.
 await db.exec("create or replace function private.dashboard_admin_live_report_country(p_country text,p_platform text) returns text language sql immutable set search_path='' as $$select case $1 when 'BR' then '印度' when 'IN' then '印度' else $1 end$$");
 const driftQueries=[{},{country:'胖虎巴西'},{view:'operators'}],driftExpected=[];
 await db.query("select set_config('test.scope','{}',false)");
 await db.exec(baseline);for(const q of driftQueries)driftExpected.push(await call(db,q));
 await db.exec(candidate);for(let i=0;i<driftQueries.length;i++)assert.deepEqual(await call(db,driftQueries[i]),driftExpected[i],'shared mapping drift falls back');
 assert.equal(after.hash,'2938e5c2257e166c2c98f607de7b51e0');
 await db.exec(candidate);assert.deepEqual(await ctx.f2.meta(db,sig),after);
 }finally{await db.close();}});
