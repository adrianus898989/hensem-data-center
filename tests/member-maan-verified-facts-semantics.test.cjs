const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const dir=path.resolve(__dirname,'..');
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/member-maan-verified-facts/baseline-functions.json'),'utf8')).find(x=>x.identity==='private.dashboard_admin_live_member_daily(jsonb)').definition.replace('private.dashboard_admin_live_member_daily(','private.member_baseline(');
const candidate=fs.readFileSync(path.join(dir,'supabase/maintenance/member-maan-verified-facts.sql'),'utf8').split('$member_facts_definition$')[1];
const A='11111111-1111-4111-8111-111111111111';let db;
before(async()=>{db=new PGlite();await db.exec(`create schema private;
create table private.catalog(id uuid,name text,country text,team text,source text,source_name text,scope_group text,timezone text,currency text);
insert into private.catalog values('${A}','Test MAAN','印度','Test','newar','MAANWIN','IN','Asia/Kolkata','INR');
create function private.dashboard_admin_live_scope()returns boolean language plpgsql as $$begin if current_setting('test.denied',true)='yes' then raise exception using errcode='42501',message='denied';end if;return true;end;$$;
create function private.dashboard_admin_live_platforms()returns setof private.catalog language sql stable as $$select * from private.catalog$$;
create function private.dashboard_admin_live_expand_provider_filter(q jsonb)returns jsonb language sql stable as $$ select case when q->'providers'='["Test canonical"]'::jsonb then q||'{"providers":["A Pay","B Pay"]}'::jsonb else q end $$;
create table public.newar_detail_platforms(platform text,launch_at timestamptz);
insert into public.newar_detail_platforms values('MAANWIN','2026-10-05T18:30Z'),('OTHER','2026-10-05T18:30Z');
create table public.newar_detail_records(id integer primary key,platform text,dataset text,member_id text,created_at timestamptz,success_at timestamptz,provider text,channel_type text,currency text,status_group text);
create table private.maan_submission_facts(record_id integer primary key,platform text,dataset text,member_id text,created_at timestamptz,success_at timestamptz,raw_provider text,currency text,paid boolean);
create table private.proof(day date primary key,ready boolean);
insert into private.proof select d::date,true from generate_series('2026-10-10'::date,'2026-10-26'::date,interval'1day')d;
create function private.maan_submission_can_read(p_from date,p_to date)returns boolean language plpgsql stable as $$begin
if current_setting('test.proof_null',true)='yes' then return null;end if;
if current_setting('test.proof_throw',true)='yes' then raise exception 'proof should not be called';end if;
return p_from>=date'2026-10-10' and p_to>p_from and not exists(select 1 from generate_series(p_from::timestamp,(p_to-1)::timestamp,interval'1day')d left join private.proof p on p.day=d::date where p.ready is distinct from true);end;$$;
insert into public.newar_detail_records select g,'MAANWIN',case when g%4=0 then 'withdraw'else'charge'end,
 case when g%13=0 then null when g%17=0 then '   ' when g%5=0 then ' member'||(g%9) ||' ' else 'member'||(g%9)end,
 timestamptz'2026-10-23T18:30Z'+(g%48)*interval'1hour',
 case when g%7=0 then null else timestamptz'2026-10-24T18:30Z'+(g%48)*interval'1hour'end,
 case when g%11=0 then null when g%5=0 then ''when g%3=0 then ' B Pay 'else 'A Pay'end,
 case when g%5=0 then'ManualRecharge'else'Normal'end,
 case when g%19=0 then'USD'else'INR'end,
 case when g%7=0 then'pending'when g%4=0 then'rejected'else'success'end from generate_series(1,120)g;
insert into private.maan_submission_facts select id,platform,dataset,nullif(btrim(member_id),''),created_at,success_at,
 case when coalesce(btrim(provider),'')=''and channel_type='ManualRecharge'then'人工充值'else coalesce(nullif(btrim(provider),''),'未识别通道')end,currency,status_group='success'from public.newar_detail_records where dataset='charge';`);await db.exec(baseline);await db.exec(candidate);});
after(async()=>db?.close());
const tx=async f=>{await db.exec('begin');try{await f();}finally{await db.exec('rollback');}};
const req=(x={})=>({platformId:A,startAt:'2026-10-23T18:30:00Z',endAt:'2026-10-24T18:30:00Z',direction:'all',currency:'INR',successBasis:'created',...x});
const compare=async q=>{const {rows:[r]}=await db.query("select private.member_baseline($1)-'asOf' old,private.dashboard_admin_live_member_daily($1)-'asOf' new",[q]);assert.deepEqual(r.new,r.old);assert.equal(r.new.capabilities.sourceCompletenessVerified,false);return r.new;};
for(const direction of ['all','charge','withdraw'])for(const providers of [undefined,['A Pay'],['A Pay','B Pay'],['Test canonical'],['人工充值'],['未识别通道'],['No data']])test(`creation parity: ${direction} / ${providers||'all providers'}`,()=>tx(async()=>{await compare(req({direction,...(providers?{providers}:{})}));}));
for(const label of ['no currency','USD','empty currency','partial day','two local days','empty exact day'])test(label,()=>tx(async()=>{let q=req();if(label==='no currency')delete q.currency;if(label==='USD')q.currency='USD';if(label==='empty currency')q.currency='';if(label==='partial day'){q.startAt='2026-10-24T00:15:00Z';q.endAt='2026-10-24T09:43:00Z';}if(label==='two local days')q.endAt='2026-10-25T18:30:00Z';if(label==='empty exact day'){q.startAt='2026-10-25T18:30:00Z';q.endAt='2026-10-26T18:30:00Z';}await compare(q);}));
test('known truth: multi-provider repeat member is deduped once, null IDs remain missing orders, frequency preserved',()=>tx(async()=>{await db.exec(`truncate public.newar_detail_records,private.maan_submission_facts;insert into public.newar_detail_records values
(1,'MAANWIN','charge',' m1 ','2026-10-24T01:00Z',null,'A Pay','Normal','INR','success'),
(2,'MAANWIN','charge','m1','2026-10-24T02:00Z',null,'B Pay','Normal','INR','success'),
(3,'MAANWIN','charge','m1','2026-10-24T03:00Z',null,'B Pay','Normal','INR','pending'),
(4,'MAANWIN','charge',null,'2026-10-24T04:00Z',null,'A Pay','Normal','INR','success'),
(5,'MAANWIN','charge',' ','2026-10-24T05:00Z',null,'B Pay','Normal','INR','pending');
insert into private.maan_submission_facts select id,platform,dataset,nullif(btrim(member_id),''),created_at,success_at,provider,currency,status_group='success' from public.newar_detail_records;`);const r=await compare(req({providers:['A Pay','B Pay'],direction:'charge'}));assert.equal(r.rows[0].created_member_count,1);assert.equal(r.rows[0].success_member_count,1);assert.equal(r.rows[0].created_order_count,5);assert.equal(r.rows[0].success_order_count,3);assert.equal(r.rows[0].created_missing_member_count,2);assert.equal(r.rows[0].success_missing_member_count,1);assert.equal(r.rows[0].created_members_ge3,1);assert.equal(r.rows[0].success_members_ge2,1);}));
for(const state of ['false','null','partial final day missing'])test(`unproved ${state} uses original raw path`,()=>tx(async()=>{await db.exec('truncate private.maan_submission_facts');let q=req();if(state==='false')await db.exec("update private.proof set ready=false where day='2026-10-24'");if(state==='null')await db.exec("set test.proof_null='yes'");if(state==='partial final day missing'){q.endAt='2026-10-24T19:15:00Z';await db.exec("update private.proof set ready=false where day='2026-10-25'");}const r=await compare(q);assert(r.rows.some(x=>x.created_order_count>0));}));
for(const reason of ['legacy success','withdraw only','other platform','other native country','other timezone','historical cutoff'])test(`outside guard: ${reason} keeps original path`,()=>tx(async()=>{await db.exec('truncate private.maan_submission_facts');const q=req();if(reason==='legacy success')delete q.successBasis;if(reason==='withdraw only')q.direction='withdraw';if(reason==='other platform')await db.exec("update private.catalog set source_name='OTHER';update public.newar_detail_records set platform='OTHER'");if(reason==='other native country')await db.exec("update private.catalog set scope_group='PK'");if(reason==='other timezone')await db.exec("update private.catalog set timezone='Asia/Calcutta'");if(reason==='historical cutoff'){q.startAt='2026-10-08T18:30:00Z';q.endAt='2026-10-09T18:30:00Z';await db.exec("update public.newar_detail_records set created_at=created_at-interval'15days'");}else await db.exec("set test.proof_throw='yes'");await compare(q);}));
test('launch cutoff applied identically even when facts include older rows',()=>tx(async()=>{await db.exec("update public.newar_detail_platforms set launch_at='2026-10-24T09:00Z' where platform='MAANWIN'");await compare(req());}));
test('current status conversions follow facts synchronously without success timestamp fallback',()=>tx(async()=>{await db.exec("update public.newar_detail_records set status_group='success',success_at=null where dataset='charge';update private.maan_submission_facts set paid=true,success_at=null");const r=await compare(req({direction:'charge'}));assert.equal(r.rows[0].success_order_count,r.rows[0].created_order_count);}));
test('proof true actually selects typed charge while withdrawal stays raw',()=>tx(async()=>{await db.exec('truncate private.maan_submission_facts');const r=(await db.query('select private.dashboard_admin_live_member_daily($1) r',[req()])).rows[0].r;assert.equal(r.rows.find(x=>x.direction==='charge').created_order_count,0);assert(r.rows.find(x=>x.direction==='withdraw').created_order_count>0);}));
test('authorization fails before any proof check',()=>tx(async()=>{await db.exec("set test.denied='yes';set test.proof_throw='yes'");await assert.rejects(db.query('select private.dashboard_admin_live_member_daily($1)',[req()]),e=>e.code==='42501');}));
