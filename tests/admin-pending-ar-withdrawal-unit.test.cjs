'use strict';
// Exact private publisher and actual hooked publication path; synthetic orders only.
const {test,before,beforeEach,afterEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const inherited=read('admin-pending-capture-archive.test.cjs').split('\nbefore(async()=>')[0];
const fixture=new Function('require','__dirname',inherited+'\nreturn {setup,publish,make,migration};')(require,__dirname);
const migration=read('../supabase/migrations/20261004120209_pending_ar_owner_confirmed_withdrawal_unit.sql');
const baseline=read('fixtures/pending-analysis/pending-capture-archive-publisher-current.sql');
const signature='private.archive_withdraw_pending_capture(text,text,text,timestamptz)';
const entries=[...migration.matchAll(/\('([^']+)','([a-f0-9-]{36})'::uuid\)/g)].map(m=>({platform:m[1],id:m[2]}));
const token='1'.repeat(64),at='2026-10-03T18:30:20Z';let db,control;
const scalar=async(q,a=[],d=db)=>Object.values((await d.query(q,a)).rows[0])[0];
const metadata=d=>scalar("select to_jsonb(p)-'prosrc'from pg_proc p where oid=$1::regprocedure",[signature],d);
const tables=d=>scalar("select jsonb_object_agg(oid::regclass::text,to_jsonb(c))from pg_class c where oid=any(array['private.withdraw_pending_capture_archive'::regclass,'private.withdraw_pending_capture_orders'::regclass,'public.ar_config_targets'::regclass,'private.collector_platform_identities'::regclass,'public.dashboard_platform_team_map'::regclass])",[],d);
async function setup(){const d=await fixture.setup();await d.exec(fixture.migration);await d.exec(`alter table private.collector_platform_identities add column verified_at timestamptz not null default '2026-09-01T00:00:00Z';alter table public.dashboard_platform_team_map add column updated_at timestamptz not null default '2026-09-01T00:00:00Z'`);await d.exec(baseline);return d;}
async function bind(d=db,{platform=entries[0].platform,id=entries[0].id,country='IN',team='M8',source='AR',zone='Asia/Kolkata',currency=null,verifiedAt='2026-09-01T00:00:00Z'}={}){
 const map=randomUUID();await d.query('insert into dashboard_platform_team_map(id,team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform,updated_at)values($1,$2,$3,$3,$4,$4,$4,$5,$5,$6)',[map,team,source,country,platform,verifiedAt]);
 await d.query('insert into private.collector_platform_identities(platform_id,mapping_id,source_system,source_country,source_platform,team_name,country_code,timezone,currency,verified_at)values($1,$2,$3,$4,$5,$6,$4,$7,$8,$9)',[id,map,source,country,platform,team,zone,currency,verifiedAt]);
 if(source==='AR')await d.query('insert into ar_config_targets(country_code,platform,country_name,timezone,currency,source_system)values($1,$2,$1,$3,$4,\'AR\')',[country,platform,zone,currency]);
 else await d.query('insert into newar_detail_platforms(platform,country_code,country,timezone,currency)values($1,$2,$2,$3,$4)',[platform,country,zone,currency]);
 return map;
}
async function window(d=db,{platform=entries[0].platform,country='IN',zone='Asia/Kolkata',captureAt=at,service=false,zero=false,broken=false,snapshots=null}={}){
 await d.query('update withdraw_pending_credentials set allowed_scopes=allowed_scopes||$1::jsonb where token_hash=$2',[[{country_code:country,platform,timezone:zone}],token]);
 const days=(await d.query("select to_char(date_day,'YYYY-MM-DD')as date_text from generate_series(($1::timestamptz at time zone $2)::date-7,($1::timestamptz at time zone $2)::date-1,interval '1 day')as g(date_day)",[captureAt,zone])).rows.map(r=>r.date_text);
 const acks=[],values=[];for(let i=0;i<days.length;i++){const value=snapshots?.[i]||fixture.make(days[i],{platform,country,zone,at:captureAt,...zero?{rows:[]}:{} });
  if(broken&&i===days.length-1)await d.query('update withdraw_pending_orders set raw_channel=\'UNKNOWN\'where stat_date=$1',[days[0]]);
  values.push(value);acks.push(await fixture.publish(d,value,{service}));}
 return {acks,values,head:(await d.query('select *from private.withdraw_pending_capture_archive where platform=$1 and country_code=$2 and snapshot_at=$3',[platform,country,captureAt])).rows[0]};
}
before(async()=>{assert.equal(entries.length,15);db=await setup();control=await setup();assert.equal(await scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[signature]),'150cd34b42791d3baef03e9e12a73676');});
beforeEach(async()=>{await db.exec('begin');await control.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');await control.exec('rollback;reset role');});after(async()=>{await db?.close();await control?.close();});
test('guarded function patch preserves every OID, security attribute, grant, table and immutable trigger on replay',async()=>{
 const meta=await metadata(db),t=await tables(db),triggers=await scalar('select jsonb_agg(to_jsonb(t)order by oid)from pg_trigger t where not tgisinternal');await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));
 assert.deepEqual(await metadata(db),meta);assert.deepEqual(await tables(db),t);assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(t)order by oid)from pg_trigger t where not tgisinternal'),triggers);
 const def=await scalar('select pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)',[signature]),def);
 for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);assert.equal(await scalar('select has_function_privilege(\'service_role\',$1,\'EXECUTE\')',[signature]),true);
});
test('all fifteen exact AR native identities acquire INR on complete future publication without changing ACK, amounts, counts, orders or registry currency',async()=>{
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));
 for(const entry of entries){await bind(db,entry);await bind(control,entry);const actual=await window(db,{...entry,service:true}),old=await window(control,{...entry,service:true,snapshots:actual.values});assert.deepEqual(actual.acks,old.acks);assert.equal(actual.head.currency,'INR',entry.platform);assert.equal(old.head.currency,null);assert.equal(actual.head.pending_count,7);assert.equal(Number(actual.head.pending_amount),700);assert.equal(actual.head.within_midnight_window,true);assert.equal(actual.head.snapshot_at.getTime(),Date.parse(at));
  const filter='from private.withdraw_pending_capture_orders where archive_id=$1';assert.deepEqual((await db.query('select order_no,amount,applied_at,raw_channel,channel_type,status '+filter,[actual.head.id])).rows,(await control.query('select order_no,amount,applied_at,raw_channel,channel_type,status '+filter,[old.head.id])).rows);}
 assert.ok((await db.query('select currency from ar_config_targets')).rows.every(r=>r.currency===null));assert.ok((await db.query('select currency from private.collector_platform_identities')).rows.every(r=>r.currency===null));
});
test('explicit native USDT and INR currency retain priority without affecting deposits, fees or shared catalog metadata',async()=>{
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));
 for(const [i,currency]of ['USDT','INR'].entries()){await bind(db,{...entries[i],currency});const {head}=await window(db,entries[i]);assert.equal(head.currency,currency);assert.equal(await scalar('select currency from ar_config_targets where platform=$1',[entries[i].platform]),currency);}
 assert.doesNotMatch(migration,/\bupdate\s+(?:public|private)\.(?:ar_config_targets|collector_platform_identities|withdraw_pending_capture_archive|withdraw_pending_capture_orders)/i);
});
test('same names in another country, source, team, timezone or native ID never inherit the owner unit rule',async()=>{
 const variants=[{...entries[0],country:'BR',zone:'America/Sao_Paulo'},{...entries[1],team:'OTHER'},{...entries[2],zone:'Asia/Karachi'},{...entries[3],id:randomUUID()},{...entries[4],platform:'UNCONFIRMED'},{...entries[5],source:'NEW_AR',currency:'USDT'}];
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));for(const variant of variants){await bind(db,variant);const {head}=await window(db,variant);assert.ok(head);assert.equal(head.currency,variant.currency||null);}
});
test('incomplete receipts and conflicting registry mappings still cannot prove a currency or archive',async()=>{
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));await bind();const {head}=await window(db,{broken:true});assert.equal(head,undefined);
 await bind(db,entries[1]);await db.query('insert into dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform)values(\'OTHER\',\'AR\',\'AR\',\'India alias\',\'IN\',\'alias\',$1,$1)',[entries[1].platform]);const conflict=await window(db,entries[1]);assert.equal(conflict.head.identity_status,'legacy_unbound');assert.equal(conflict.head.currency,null);
});
test('pre-confirmation calendar and already immutable archives keep unknown currency; later actual reruns receive unit without changing midnight eligibility',async()=>{
 await bind();const old=await window(db,{captureAt:'2026-10-02T18:30:20Z'}),before=await window();assert.equal(old.head.currency,null);assert.equal(before.head.currency,null);await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));
 const replay=await scalar('select private.archive_withdraw_pending_capture(\'WITHDRAW_REVIEW\',\'IN\',$1,$2)',[entries[0].platform,at]);assert.equal(replay,before.head.id);assert.deepEqual((await db.query('select *from private.withdraw_pending_capture_archive where id=$1',[before.head.id])).rows[0],before.head);
 const late=await window(db,{captureAt:'2026-10-03T19:40:20Z'});assert.equal(late.head.currency,'INR');assert.equal(late.head.within_midnight_window,false);assert.equal(late.head.snapshot_at.getTime(),Date.parse('2026-10-03T19:40:20Z'));assert.equal(Number(late.head.pending_amount),700);
});
test('a real complete zero remains zero and exact five-minute cutoff is unchanged',async()=>{
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));await bind();for(const [captureAt,expected]of [['2026-10-03T18:30:00Z',true],['2026-10-03T18:35:00Z',true],['2026-10-03T18:35:01Z',false]]){const {head}=await window(db,{captureAt,zero:true});assert.equal(head.currency,'INR');assert.equal(head.pending_count,0);assert.equal(Number(head.pending_amount),0);assert.equal(head.within_midnight_window,expected);}
});
test('unsupported explicit payload currency is rejected by the existing source contract rather than overwritten with INR',async()=>{
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));await bind();const {snapshot}=fixture.make('2026-10-03',{platform:entries[0].platform,at});snapshot.currency='USDT';await db.exec('savepoint invalid');await assert.rejects(db.query('select public.withdraw_pending_assert_snapshot($1)',[snapshot]),/WP_INVALID_SNAPSHOT/);await db.exec('rollback to invalid');assert.equal(await scalar('select count(*)from private.withdraw_pending_capture_archive'),0);
});
test('explicit currency in any exact receipt partition defensively blocks owner fallback without guessing a supported unit',async()=>{
 await bind();const observed=await window();
 // Synthetic legacy/corrupt-source setup only: remove its synthetic archive to
 // exercise the current publisher against still-present source receipts.
 await db.exec('alter table private.withdraw_pending_capture_archive disable trigger withdraw_pending_capture_header_immutable;alter table private.withdraw_pending_capture_orders disable trigger withdraw_pending_capture_order_immutable');
 await db.query('delete from private.withdraw_pending_capture_orders where archive_id=$1',[observed.head.id]);await db.query('delete from private.withdraw_pending_capture_archive where id=$1',[observed.head.id]);
 await db.exec('alter table private.withdraw_pending_capture_archive enable trigger withdraw_pending_capture_header_immutable;alter table private.withdraw_pending_capture_orders enable trigger withdraw_pending_capture_order_immutable');
 await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));
 for(const [key,value]of [['currency','USDT'],['currency_code','USDT'],['amount_currency',null]]){
  await db.exec('savepoint declared');await db.query('update withdraw_pending_daily set snapshot=jsonb_set(snapshot,array[$1],$2::jsonb)where platform=$3 and stat_date=\'2026-10-03\'',[key,JSON.stringify(value),entries[0].platform]);
  await db.exec("update withdraw_pending_order_receipts r set scope=d.snapshot-array['schema_version','coverage','totals','groups']from withdraw_pending_daily d where d.snapshot_id=r.snapshot_id");
  const id=await scalar('select private.archive_withdraw_pending_capture(\'WITHDRAW_REVIEW\',\'IN\',$1,$2)',[entries[0].platform,at]);assert.ok(id);assert.equal(await scalar('select currency from private.withdraw_pending_capture_archive where id=$1',[id]),null);await db.exec('rollback to declared');
 }
});
test('original enrollment timing and source-specificity still block delayed unbound observations and recharge calls',async()=>{
 const entry=entries.find(e=>e.platform==='Shree.Win');await bind(db,{...entry,verifiedAt:'2026-10-04T00:00:00Z'});await db.exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,''));
 const {head}=await window(db,entry);assert.equal(head.identity_status,'legacy_unbound');assert.equal(head.currency,null);
 assert.equal(await scalar('select private.archive_withdraw_pending_capture(\'RECHARGE_REVIEW\',\'IN\',$1,$2)',[entry.platform,at]),null);
});
test('broader ACL, security settings, full definition/body drift and target drift abort atomically',async()=>{
 const code=migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,'');for(const change of ["grant execute on function "+signature+" to authenticated","alter function "+signature+" security invoker","alter function "+signature+" set search_path='public'","create or replace function private.archive_withdraw_pending_capture(p_source_system text,p_country_code text,p_platform text,p_snapshot_at timestamptz)returns uuid language plpgsql security definer set search_path=''as $$begin return null;end$$;"]){await db.exec('savepoint drift');await db.exec(change);await assert.rejects(db.exec(code),/pending_ar_unit_(metadata|baseline)_drift/);await db.exec('rollback to drift');}
 await db.exec('savepoint target');await assert.rejects(db.exec(code.replaceAll('"INR"','"USDT"')),/pending_ar_unit_target_drift/);await db.exec('rollback to target');assert.equal(await scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[signature]),'150cd34b42791d3baef03e9e12a73676');
});
