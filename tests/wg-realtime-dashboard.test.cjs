const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const {wgRealtimeQuery}=loadTs(path.join(root,'supabase/functions/dashboard-api/lib/wgRealtimeQuery.ts'));
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260930093000_wg_realtime_dashboard.sql'),'utf8');
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.dashboard_has_permission(text)returns boolean language sql as $$select current_setting('test.allow',true)='yes'$$;
 create function private.dashboard_current_data_scope()returns jsonb language sql as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text)returns boolean language sql as $$select $2='BR' and $3='26BET'$$;
 create table private.wg_detail_progress(site_code text,business text,basis text,floor bigint,cursor bigint);
 create table private.wg_detail_history(site_code text,business text,basis text,range_start bigint,cursor bigint);
 create table public.wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table public.wg_recharge_details(site_code text,order_number text,third_order_number text,provider text,channel text,status_code int,status_group text,
 created_at timestamptz,success_at timestamptz,updated_at timestamptz,operated_at timestamptz,captured_at timestamptz,member_currency text,member_amount numeric,
 settlement_currency text,settlement_amount numeric,settlement_fee numeric,business_fields jsonb,source_fields jsonb);
 create table public.wg_withdraw_details(like public.wg_recharge_details);
 create table public.wg_realtime_config_daily(site_code text,platform text,country_code text,observed_local_date date,observed_at timestamptz,received_at timestamptz,
 timezone text,parser_version text,snapshot_id uuid,configuration jsonb);
 create table public.wg_withdraw_midnight_runs(site_code text,snapshot_date date,scheduled_at timestamptz,window_start timestamptz,window_end timestamptz,
 status text,observed_started_at timestamptz,observed_finished_at timestamptz,record_count integer);
 select set_config('test.uid','10000000-0000-0000-0000-000000000001',false),set_config('test.allow','yes',false);`);
 await db.exec(migration);
 for(const [id,status,group,created,operated]of [['A',4,'success','2026-09-30T04:00:00Z','2026-09-30T05:00:00Z'],['B',3,'paying','2026-09-30T04:00:00Z','2026-09-30T05:00:00Z'],['C',8,'forced','2026-09-30T04:00:00Z','2026-09-30T05:00:00Z'],['OLD',4,'success','2026-09-29T04:00:00Z','2026-09-30T05:00:00Z']]){
   await db.query(`insert into public.wg_withdraw_details values('278',$1,null,'Provider','PIX',$2,$3,$4,null,null,$5,now(),'BRL',10.5,'BRL',10,0,$6,'{"secret":"PRIVATE_SENTINEL"}')`,[id,status,group,created,operated,{operator_name:'system',operator_class:'auto',remark_sanitized:'安全业务模板',rejection_reason:null,interception_reason:'首提拦截',note_state:'template'}]);
 }
 await db.exec(`insert into public.wg_withdraw_midnight_runs(site_code,snapshot_date,status,record_count)values('278','2026-09-30','missed',null);
 insert into public.wg_realtime_config_daily(site_code,platform,country_code,observed_local_date,configuration)values('278','26BET','BR','2026-09-30','{"settings":{"0":{},"278":{},"8311":{"secret":"OTHER_BRAND"}},"dictionaries":{},"completeness":{}}');`);
});
after(async()=>db?.close());
async function rpc(overrides={}){
 const p={site:'278',start:'2026-09-30',end:'2026-09-30',business:'withdraw',basis:'created',section:'orders',page:1,size:50,query:'',...overrides};
 return (await db.query('select public.dashboard_wg_realtime($1,$2,$3,$4,$5,$6,$7,$8,$9) data',Object.values(p))).rows[0].data;
}
test('fixed five sites, real calendar, 31 day bound, pagination, axis validated',()=>{
 const params=new URLSearchParams({site:'278',start:'2026-09-01',end:'2026-09-30',business:'withdraw',basis:'operated'});
 assert.equal(wgRealtimeQuery(params).p_basis,'operated');
 for(const [k,v]of [['site','3913'],['start','2026-02-30'],['end','2026-10-02'],['size','101'],['page','0'],['basis','success'],['section','raw']]){
  const q=new URLSearchParams(params);q.set(k,v);assert.throws(()=>wgRealtimeQuery(q));
 }
});
test('RPC requires logged in permission and actual scope, never base-table grant',async()=>{
 await db.exec(`select set_config('test.allow','no',false)`);await assert.rejects(rpc(),/PERMISSION_DENIED/);
 await db.exec(`select set_config('test.allow','yes',false)`);await assert.rejects(rpc({site:'3257'}),/SCOPE_DENIED/);
 await db.exec(`select set_config('test.uid','',false)`);await assert.rejects(rpc(),/PERMISSION_DENIED/);
 await db.exec(`select set_config('test.uid','10000000-0000-0000-0000-000000000001',false)`);
 const grants=(await db.query(`select has_function_privilege('anon','public.dashboard_wg_realtime(text,date,date,text,text,text,integer,integer,text)','execute') anon,
 has_table_privilege('authenticated','public.wg_withdraw_details','select') orders`)).rows[0];assert.equal(grants.anon,false);assert.equal(grants.orders,false);
});
test('created vs operated local windows and deterministic server pagination',async()=>{
 const created=await rpc(), operated=await rpc({basis:'operated'});assert.equal(created.total,3);assert.equal(operated.total,4);
 const a=await rpc({size:1}),b=await rpc({size:1,page:2});assert.equal(a.rows.length,1);assert.equal(b.rows.length,1);assert.notEqual(a.rows[0].order_number,b.rows[0].order_number);
 assert.equal((await rpc({query:'A'})).total,1);assert.equal((await rpc({query:'%'})).total,0);
 assert(!JSON.stringify(created).includes('PRIVATE_SENTINEL'));assert(!('source_fields'in created.rows[0]));
});
test('paying and forced never count paid; missing coverage explicitly false',async()=>{
 const result=await rpc({section:'summary'});const r=result.rows[0];assert.equal(r.count,3);assert.equal(r.success,1);assert.equal(r.paying,1);assert.equal(r.forced,1);assert.equal(result.coverage.complete,false);
 assert.equal(r.member_amount,'31.5');assert.equal(r.auto,3);assert.equal(r.manual,0);
 assert.equal(r.success_member_amount,'10.5');assert.equal(r.success_settlement_amount,'10');assert.equal(r.unknown_status,0);
});
test('unknown is separate and failed/paying/forced money never enters success amounts',async()=>{
 await db.exec(`insert into public.wg_withdraw_details(site_code,order_number,status_code,status_group,created_at,member_currency,member_amount,settlement_currency,settlement_amount)values('278','UNKNOWN',999,'unknown','2026-09-30T04:00:00Z','BRL',99.25,'BRL',99)`);
 const row=(await rpc({section:'summary'})).rows[0];assert.equal(row.count,4);assert.equal(row.unknown_status,1);assert.equal(row.success,1);assert.equal(row.member_amount,'130.75');assert.equal(row.success_member_amount,'10.5');assert.equal(row.success_settlement_amount,'10');
 assert.equal(row.success+row.paying+row.forced+row.rejected+row.failed+row.cancelled+row.pending+row.unknown_status,row.count);
 await db.exec(`delete from public.wg_withdraw_details where order_number='UNKNOWN'`);
});
test('recharge success amounts count only 2 and keep member/payment currencies separate',async()=>{
 await db.exec(`insert into public.wg_recharge_details(site_code,order_number,status_code,status_group,created_at,member_currency,member_amount,settlement_currency,settlement_amount)values
 ('278','RC_OK',2,'success','2026-09-30T04:00:00Z','BRL',500,'USDT',100),
 ('278','RC_UNKNOWN',4,'unknown','2026-09-30T04:00:00Z','BRL',250,'USDT',50),
 ('278','RC_BRL',2,'success','2026-09-30T04:00:00Z','BRL',10,'BRL',10)`);
 const result=await rpc({section:'summary',business:'recharge'});assert.equal(result.rows.length,2);
 const usd=result.rows.find(r=>r.settlement_currency==='USDT');assert.equal(usd.member_amount,'750');assert.equal(usd.settlement_amount,'150');assert.equal(usd.success,1);assert.equal(usd.success_member_amount,'500');assert.equal(usd.success_settlement_amount,'100');assert.equal(usd.unknown_status,1);
});
test('operator is current last operator, reasons safely displayed, no old aggregates',async()=>{
 const op=await rpc({section:'operators'});assert.equal(op.rows[0].operator_name,'system');assert.equal(op.rows[0].count,3);
 const reason=await rpc({section:'reasons'});assert.equal(reason.rows[0].label,'首提拦截');assert.equal(reason.rows[0].count,3);assert.equal(reason.source,'wg_realtime_only');
});
test('coverage must include every requested local day, and stale rejection cannot label paid',async()=>{
 await db.exec(`insert into public.wg_detail_coverage values('278','withdraw','created','2026-09-30',true);
 update public.wg_withdraw_details set business_fields=business_fields||'{"rejection_reason":"STALE_REJECTION"}'::jsonb where order_number='A'`);
 assert.equal((await rpc()).coverage.complete,true);
 assert.equal((await rpc({start:'2026-09-29'})).coverage.complete,false);
 assert(!JSON.stringify(await rpc({section:'reasons'})).includes('STALE_REJECTION'));
});
test('config returns selected brand plus default, midnight missed stays null',async()=>{
 const config=await rpc({section:'config'});assert.deepEqual(Object.keys(config.rows[0].configuration.settings).sort(),['0','278']);assert(!JSON.stringify(config).includes('OTHER_BRAND'));
 const midnight=await rpc({section:'midnight'});assert.equal(midnight.rows[0].status,'missed');assert.equal(midnight.rows[0].record_count,null);
});
test('WG has no standalone entry, overlay, URL route or extra reserved header space',()=>{
 const preview=fs.readFileSync(path.join(root,'src/components/OwnerAdminPreview.tsx'),'utf8');
 const dashboard=fs.readFileSync(path.join(root,'src/components/Dashboard.tsx'),'utf8');
 const shell=fs.readFileSync(path.join(root,'src/lib/ownerPreviewShell.ts'),'utf8');
 for(const text of [preview,dashboard,shell])assert(!/WGRealtimeDashboard|wgRealtime|wg-realtime|owner-preview-(?:shell-wg|wg-page)|WG 实时数据/.test(text));
 for(const file of ['src/components/WGRealtimeDashboard.tsx','src/components/WGRealtimeDashboard.css','src/lib/wgRealtimeAccess.ts'])assert(!fs.existsSync(path.join(root,file)));
 assert.match(preview,/restoreApprovedAdmin/);assert.match(preview,/installAdminLiveBridge/);
 for(const module of ['orders','volume','auto','config','operator'])assert(dashboard.includes('"'+module+'"'));
});
