// Offline synthetic data only. Actual reviewed production definitions are guarded and executed.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261002100001_wg_exact_provider_aliases.sql');
const baseline=read('tests/fixtures/wg-exact-provider-aliases/baseline-functions.sql');
const aliases=read('tests/fixtures/wg-exact-provider-aliases/runtime-alias-and-wrapper.sql');
const fn=(s,name)=>{const start=s.toLowerCase().indexOf('create'+(s.toLowerCase().includes('create or replace function private.'+name+'(')?' or replace':'')+' function private.'+name+'(');assert(start>=0,name);const rest=s.slice(start),tag=rest.match(/\bas\s+(\$[a-z_]*\$)/i)[1],end=rest.indexOf(tag+';',rest.indexOf(tag)+tag.length);return rest.slice(0,end+tag.length+1);};
let db,sourceBefore,registryBefore,metadataBefore;
const uid='10000000-0000-0000-0000-000000000001';
const canon=(country,platform,raw)=>db.query('select private.dashboard_admin_live_provider_canonical($1,$2,$3) value',[country,platform,raw]).then(r=>r.rows[0].value);
const rows=()=>db.query('select * from private.dashboard_admin_live_provider_rows() order by country,platform,raw_provider').then(r=>r.rows);
const snapshot=(country='BR',platform='26BET')=>db.query('select private.dashboard_admin_live_payout_config($1::jsonb) value',[JSON.stringify({system:'WG',operation:'snapshot',country,platform})]).then(r=>r.rows[0].value);
const set=(key,value)=>db.query('select set_config($1,$2,false)',[key,value]);
const write=r=>db.query('select private.dashboard_admin_live_configuration_write($1::jsonb) value',[JSON.stringify(r)]).then(r=>r.rows[0].value);
async function setup(){
 const x=new PGlite();await x.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create function auth.uid() returns uuid language sql stable as $$select '${uid}'::uuid$$;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if current_setting('test.preview',true)='denied' then raise exception 'preview_denied' using errcode='42501';end if;
 return coalesce(nullif(current_setting('test.scope',true),''),'{"mode":"all"}')::jsonb;end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(s->>'mode'='all' or s->'tuples' ? ((case c when '巴西' then 'BR' when '越南' then 'VN' else c end)||':'||p),false)$$;
 create function public.dashboard_has_permission(text) returns boolean language sql stable as $$select current_setting('test.permission',true) is distinct from 'denied'$$;
 create function private.dashboard_admin_live_can_configure() returns boolean language sql stable as $$select current_setting('test.configure',true) is distinct from 'denied'$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[],charge_count bigint,withdraw_count bigint,matched_count bigint,last_data_date date,updated_at timestamptz,primary key(country,platform,raw_provider));
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version bigint default 1,updated_at timestamptz default now(),updated_by uuid,primary key(country,platform,raw_provider));
 create table public.dashboard_profiles(auth_user_id uuid,role text,active boolean);
 create table public.dashboard_platform_team_map(id uuid,team_name text,system_name text,source_system text,country_name text,country_code text,source_country text,platform_name text,source_platform text,active boolean,updated_at timestamptz);
 create table private.dashboard_admin_classification_grants(auth_user_id uuid,can_manage boolean,updated_at timestamptz,updated_by uuid);
 create table private.dashboard_admin_classification_audit(id bigint generated always as identity,actor_id uuid,operation text,entity_key jsonb,before_value jsonb,after_value jsonb,created_at timestamptz default now());
 create table public.wg_config_daily(country_code text,platform text,site_code text,timezone text,observed_at timestamptz,observed_local_date date,received_at timestamptz,parser_version text,configuration jsonb);
 create table public.wg_realtime_config_daily(like public.wg_config_daily including all);
 `);
 await x.exec(read('tests/fixtures/wg-exact-provider-aliases/native-order-schema.sql'));await x.exec(aliases);
 await x.exec(fn(read('supabase/admin-live-india-usdt-classification.sql'),'dashboard_admin_live_confirmed_usdt_provider'));
 for(const name of ['dashboard_admin_config_safe_json','dashboard_admin_config_pick','dashboard_admin_config_projection'])await x.exec(fn(read('supabase/admin-live-payout-config.sql'),name));
 await x.exec(baseline);await x.exec(read('tests/fixtures/wg-exact-provider-aliases/provider-configuration-reader.sql'));await x.exec(fn(read('supabase/admin-live-configuration-query.sql'),'dashboard_admin_live_remap_groups'));
 await x.exec(`revoke all on function private.dashboard_admin_live_provider_canonical(text,text,text),private.dashboard_admin_live_provider_rows(),private.dashboard_admin_wg_sites(),private.dashboard_admin_wg_payout_config(jsonb,jsonb) from public,anon,authenticated,service_role;
 revoke all on function private.dashboard_admin_live_configuration_write(jsonb),private.dashboard_admin_live_payout_config(jsonb) from public,anon,authenticated,service_role;
 grant execute on function private.dashboard_admin_live_configuration_write(jsonb),private.dashboard_admin_live_payout_config(jsonb) to authenticated;
 grant usage on schema private to anon,authenticated,service_role;
 `);return x;
}
const nativeSnapshot=async()=>db.query(`select * from (select 'charge' type,to_jsonb(r) data from public.wg_recharge_details r union all select 'withdraw',to_jsonb(w) from public.wg_withdraw_details w) q order by type,data::text`).then(r=>r.rows);
before(async()=>{
 db=await setup();
 // Guard all real metadata first, then populate deliberately divergent synthetic native channels.
 metadataBefore=(await db.query(`select oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid in ('private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure,'private.dashboard_admin_live_provider_rows()'::regprocedure,'private.dashboard_admin_wg_payout_config(jsonb,jsonb)'::regprocedure) order by signature`)).rows;
 for(const [country,platform,raw,name]of [['巴西','26BET','U2CPay','U2CPay'],['巴西','26BET','PIXPAY12','WinWinPay'],['巴西','OTHER','NaNaPay(BRL)','OldElsewhere'],['越南','98VV','TronPayUSDT','TronPayUSDT']])await db.query(`insert into private.dashboard_admin_provider_registry values($1,$2,$3,array[$4],array['代收'],7,0,7,'2026-10-01','2026-10-02T00:00Z')`,[country,platform,raw,name]);
 const approved=(await db.query(`select country_code,country,platform,raw_provider,canonical_provider,display_label from (${migration.slice(migration.indexOf('as $aliases$')).match(/values\n([\s\S]*?);\n\$aliases\$/)[0].replace(/;\n\$aliases\$/,'')}) t(country_code,country,platform,raw_provider,canonical_provider,display_label)`)).rows;
 for(const a of approved){const site={'26BET':'278','POPKKK':'8311','POPMIU':'12588','98VV':'3257','XX98':'3605'}[a.platform];await db.query(`insert into public.wg_recharge_details(country,platform,site_code,provider,created_at,stored_at,member_currency,settlement_currency,member_amount,settlement_amount,source_fields) values($1,$2,$3,$4,'2026-10-01T12:00Z','2026-10-02T00:00Z',$5,$6,13,2,'{"channelName":"native-unchanged"}')`,[a.country_code,a.platform,site,a.raw_provider,a.country_code==='BR'?'BRL':'VND',a.raw_provider==='TronPay(USDT)'?'USDT':a.country_code==='BR'?'BRL':'VND']);}
 await db.exec(`insert into public.wg_withdraw_details(country,platform,site_code,provider,created_at,stored_at,member_currency,settlement_currency,member_amount,settlement_amount,source_fields) values('BR','POPMIU','12588','NaNaPay(BRL)3','2026-10-01T12:00Z','2026-10-02T00:00Z','BRL','BRL',17,17,'{}');
 insert into public.wg_recharge_details(country,platform,site_code,provider,created_at,stored_at,member_currency,settlement_currency,member_amount,settlement_amount,source_fields) values('BR','26BET','WRONG','U2CPay3','2026-10-01T12:00Z','2026-10-02T00:00Z','BRL','BRL',999,999,'{}');
 insert into public.wg_recharge_details(country,platform,site_code,provider,created_at,stored_at,member_currency,settlement_currency,member_amount,settlement_amount,source_fields) values('VN','KK98','3913','TronPay(USDT)','2026-10-01T12:00Z','2026-10-02T00:00Z','VND','USDT',999,999,'{}');
 `);
 const config={settings:{0:{exemptSwitch:0},278:{exemptSwitch:1},8311:{exemptSwitch:0},12588:{exemptSwitch:1},3257:{exemptSwitch:0},3605:{exemptSwitch:1},3913:{exemptSwitch:1}},dictionaries:{merchants:[{id:'M-1',value:'NaNaPay(BRL)',token:'PRIVATE-TEST'},{id:'M-3',value:'NaNaPay(BRL)3'},{id:'T-1',value:'TronPay(USDT)'},{id:'Y-1',value:'YesPay(VND)(已删除:731329)'},{id:'U-1',value:'Unknown(BRL)3'}]},completeness:{available:['merchants'],unavailable:[]}};
 for(const [country,platform,site,tz]of [['BR','26BET','278','America/Sao_Paulo'],['VN','98VV','3257','Asia/Ho_Chi_Minh']])await db.query(`insert into public.wg_realtime_config_daily values($1,$2,$3,$4,'2026-10-02T00:00Z','2026-10-01','2026-10-02T00:00Z','synthetic',$5)`,[country,platform,site,tz,JSON.stringify(config)]);
 sourceBefore=await nativeSnapshot();registryBefore=(await db.query('select to_jsonb(r) data from private.dashboard_admin_provider_registry r order by country,platform,raw_provider')).rows;
 await db.exec(migration);
});
after(()=>db?.close());

test('37 exact native tuples canonicalize without global suffix stripping or scope expansion',async()=>{
 const mapping=(await db.query('select * from private.dashboard_admin_wg_provider_aliases()')).rows;assert.equal(mapping.length,37);
 for(const m of mapping)for(const country of [m.country,m.country_code])assert.equal(await canon(country,m.platform,m.raw_provider),m.canonical_provider);
 for(const [c,p,r]of [['BR','26BET','NaNaPay(BRL)3'],['VN','KK98','TronPay(USDT)'],['VN','XX98','YesPay(VND)(已删除:851329)'],['VN','98VV','YesPay(VND)(已删除:999999)'],['VN','98VV','TronPay(USDT)3'],['BR','POPMIU','TranSafePay(BRL)33'],['IN','POPMIU','NaNaPay(BRL)3']])assert.equal(await canon(c,p,r),r);
 assert.equal(await canon('巴西','OTHER','NaNaPay(BRL)'),'OldElsewhere');assert.equal(await canon('巴西','26BET','PIXPAY12'),'WinWinPay','same channel code must not be globally reassigned');
});
test('configuration projection adds only observed missing raw tuples, distinguishes unknown counts from absent directions, never duplicates registry data',async()=>{
 const result=await rows();assert.equal(result.length,40);const x=result.find(r=>r.platform==='POPMIU'&&r.raw_provider==='NaNaPay(BRL)3');assert.equal(x.charge_count,null);assert.equal(x.withdraw_count,null);assert.equal(x.matched_count,null);assert.equal(x.last_data_date,null);assert.equal(x.updated_at,null);assert.deepEqual(x.directions,['代付','代收']);assert.equal(x.status,'assigned');assert.equal(x.canonical_provider,'NanaPay');
 const chargeOnly=result.find(r=>r.platform==='98VV'&&r.raw_provider==='V8Pay(VND)');assert.equal(chargeOnly.charge_count,null);assert.equal(chargeOnly.withdraw_count,0);assert.equal(chargeOnly.matched_count,null);assert.deepEqual(chargeOnly.directions,['代收']);
 const existing=result.filter(r=>r.platform==='26BET'&&r.raw_provider==='U2CPay');assert.equal(existing.length,1);assert.equal(existing[0].matched_count,7,'retained registry row is not incremented from a second data source');
 assert(!result.some(r=>r.platform==='KK98'));assert(!result.some(r=>r.platform==='26BET'&&r.raw_provider==='U2CPay3'));
 assert.deepEqual(await nativeSnapshot(),sourceBefore);assert.deepEqual((await db.query('select to_jsonb(r) data from private.dashboard_admin_provider_registry r order by country,platform,raw_provider')).rows,registryBefore);
});
test('actual unchanged provider configuration reader preserves unknown counts and summaries count classification rows only',async()=>{
 const dto=(await db.query("select private.dashboard_admin_live_provider_config($1::jsonb) value",[JSON.stringify({country:'越南',platform:'98VV',limit:100})])).rows[0].value;
 const row=dto.rows.find(x=>x.rawProvider==='V8Pay(VND)');assert.equal(row.chargeCount,null);assert.equal(row.withdrawCount,0);assert.equal(row.matchedCount,null);assert.equal(row.lastDataDate,null);assert.equal(row.updatedAt,null);
 assert.equal(dto.summary.rawProviders,dto.total);assert.equal(dto.summary.assigned,dto.total);assert(!Object.hasOwn(dto.summary,'matchedCount'),'null native counts must not be collapsed into an incomplete total');
});
test('scoped WG configuration shows only authorized member mappings and never obsolete KK98',async()=>{
 await set('test.scope',JSON.stringify({mode:'selected',tuples:['BR:POPMIU','VN:XX98']}));
 try{const result=await rows();assert(result.every(r=>['POPMIU','XX98'].includes(r.platform)));const br=await snapshot();assert.deepEqual(br.target.members,[{site_code:'12588',name:'POPMIU'}]);const merchants=br.snapshot.configuration.dictionaries.merchants;
 assert.deepEqual(merchants.find(x=>x.id==='M-3').memberPlatforms,[{site_code:'12588',name:'POPMIU'}]);assert.equal(merchants.find(x=>x.id==='M-1').canonicalProvider,undefined);
 assert.deepEqual(Object.keys(br.snapshot.configuration.settings).sort(),['0','12588']);assert(!JSON.stringify(br).includes('PRIVATE-TEST'));assert.equal(merchants.find(x=>x.id==='M-3').value,'NaNaPay(BRL)3');
 const vn=await snapshot('VN','98VV');assert.deepEqual(vn.target.members,[{site_code:'3605',name:'XX98'}]);assert.equal(vn.snapshot.configuration.dictionaries.merchants.find(x=>x.id==='T-1').displayLabel,'TronPay');assert(!JSON.stringify(vn).includes('3913'));
 await assert.rejects(snapshot('BR','POPMIU'),/config_target_denied/);
 }finally{await set('test.scope','');}
});
test('merchant associations preserve native IDs/values, distinguish child suffixes and retained fee identity',async()=>{
 const br=await snapshot();const m=br.snapshot.configuration.dictionaries.merchants;
 assert.deepEqual(m.find(x=>x.id==='M-1').memberPlatforms,[{site_code:'278',name:'26BET'},{site_code:'8311',name:'POPKKK'}]);assert.equal(m.find(x=>x.id==='M-1').canonicalProvider,'NanaPay');
 assert.deepEqual(m.find(x=>x.id==='M-3').memberPlatforms,[{site_code:'12588',name:'POPMIU'}]);assert.deepEqual(m.find(x=>x.id==='U-1'),{id:'U-1',value:'Unknown(BRL)3'});
 const vn=(await snapshot('VN','98VV')).snapshot.configuration.dictionaries.merchants.find(x=>x.id==='T-1');assert.equal(vn.canonicalProvider,'TronPayUSDT');assert.equal(vn.displayLabel,'TronPay');assert.equal(vn.value,'TronPay(USDT)');assert.equal(vn.id,'T-1');
});
test('real group remapper merges approved YesPay aliases once without mixing dates, directions or currencies',async()=>{
 const sample=(provider,date='2026-10-01',direction='charge',currency='VND')=>({provider,date,direction,currency,all_count:2,success_count:1,all_amount:'10',success_amount:'4',pending_amount:'6'});
 const input=[sample('YesPay(VND)'),sample('YesPay(VND)(已删除:731329)'),sample('YesPay(VND)','2026-10-02'),sample('YesPay(VND)','2026-10-01','withdraw'),sample('YesPay(VND)','2026-10-01','charge','USDT')],before=JSON.stringify(input);
 const result=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) value',[before,'越南','98VV'])).rows[0].value;
 assert.equal(result.length,4);assert(result.every(x=>x.provider==='YesPay'));const merged=result.find(x=>x.date==='2026-10-01'&&x.direction==='charge'&&x.currency==='VND');
 assert.equal(merged.all_count,4);assert.equal(merged.success_count,2);assert.equal(Number(merged.all_amount),20);assert.equal(Number(merged.success_amount),8);assert.equal(JSON.stringify(input),before);
});
test('source-supplied association metadata cannot forge mappings and conflicting manual members do not become first-row-wins',async()=>{
 const target={country_code:'BR',platform:'26BET',members:[{site_code:'278',name:'26BET'},{site_code:'8311',name:'POPKKK'}]};
 const input=[{id:'fake',value:'Unknown(BRL)3',canonicalProvider:'NanaPay',displayLabel:'Forged',memberPlatforms:target.members},{id:'native',value:'NaNaPay(BRL)',canonicalProvider:'Forged',displayLabel:'Forged',memberPlatforms:[{site_code:'3913',name:'KK98'}]},'unexpected scalar'];
 const annotate=()=>db.query('select private.dashboard_admin_wg_merchant_associations($1::jsonb,$2::jsonb) value',[JSON.stringify(target),JSON.stringify(input)]).then(r=>r.rows[0].value);
 let result=await annotate();assert.deepEqual(result[0],{id:'fake',value:'Unknown(BRL)3'});assert.equal(result[1].canonicalProvider,'NanaPay');assert.equal(result[1].displayLabel,'NanaPay');assert.deepEqual(result[1].memberPlatforms,target.members);assert.equal(result[2],'unexpected scalar');
 await db.query("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider,updated_by) values('巴西','POPKKK','NaNaPay(BRL)','DifferentProvider',$1)",[uid]);
 try{result=await annotate();assert.deepEqual(result[1],{id:'native',value:'NaNaPay(BRL)'},'a shared native merchant with conflicting per-platform overrides is not silently assigned');}finally{await db.exec("delete from private.dashboard_admin_provider_overrides where canonical_provider='DifferentProvider'");}
});
test('unobserved tuples do not create a configuration count and wrong country/site evidence cannot supply one',async()=>{
 await db.exec('begin');try{
  await db.exec("delete from public.wg_recharge_details where platform='98VV' and provider='V8Pay(VND)'");
  const visible=await rows();assert(!visible.some(x=>x.platform==='98VV'&&x.raw_provider==='V8Pay(VND)'));assert(visible.some(x=>x.platform==='XX98'&&x.raw_provider==='V8Pay(VND)'));
 }finally{await db.exec('rollback');}
});
test('existing configuration writer enforces grants, scope and CAS, audits native tuple and shares overrides with grouping/config',async()=>{
 const prior=(await rows()).find(r=>r.platform==='POPMIU'&&r.raw_provider==='NaNaPay(BRL)3');const request={operation:'provider',country:'巴西',platform:'POPMIU',rawProvider:prior.raw_provider,canonicalProvider:'ManualNana',expectedVersion:prior.version};
 await set('test.configure','denied');await assert.rejects(write(request),/configuration_denied/);await set('test.configure','');
 await set('test.scope',JSON.stringify({mode:'selected',tuples:['BR:26BET']}));await assert.rejects(write(request),/scope_denied/);await set('test.scope','');
 assert.equal((await write(request)).ok,true);assert.equal(await canon('BR','POPMIU',prior.raw_provider),'ManualNana');assert.equal(await canon('巴西','POPMIU',prior.raw_provider),'ManualNana');
 const current=(await rows()).find(r=>r.platform==='POPMIU'&&r.raw_provider===prior.raw_provider);assert.equal(current.manual,true);assert.equal(current.canonical_provider,'ManualNana');assert.notEqual(current.version,prior.version);await assert.rejects(write(request),/configuration_conflict/);
 const merchant=(await snapshot()).snapshot.configuration.dictionaries.merchants.find(m=>m.id==='M-3');assert.equal(merchant.canonicalProvider,'ManualNana');assert.equal(merchant.displayLabel,'ManualNana');
 const audit=(await db.query('select actor_id,operation,entity_key,before_value,after_value from private.dashboard_admin_classification_audit')).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,uid);assert.equal(audit[0].entity_key.rawProvider,prior.raw_provider);assert.equal(audit[0].before_value.version,prior.version);
 await db.exec("delete from private.dashboard_admin_provider_overrides where canonical_provider='ManualNana'");
});
test('existing authorization and snapshot completeness rejection stay fail closed',async()=>{
 await set('test.permission','denied');await assert.rejects(snapshot(),/auto_withdraw_permission_denied/);await set('test.permission','');
 await set('test.preview','denied');await assert.rejects(snapshot(),/preview_denied/);await set('test.preview','');
 await set('test.scope',JSON.stringify({mode:'selected',tuples:['VN:KK98']}));assert.equal((await db.query(`select private.dashboard_admin_live_payout_config('{"operation":"index","system":"WG"}') value`)).rows[0].value.targets.length,0);await assert.rejects(snapshot('VN','98VV'),/config_target_denied/);await set('test.scope','');
});
test('no new direct client/helper grants and all existing function metadata stay unchanged',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const signature of ['private.dashboard_admin_wg_provider_aliases()','private.dashboard_admin_wg_merchant_associations(jsonb,jsonb)','private.dashboard_admin_live_provider_canonical(text,text,text)','private.dashboard_admin_live_provider_rows()','private.dashboard_admin_wg_payout_config(jsonb,jsonb)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed,false,role+':'+signature);
 const after=(await db.query(`select oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid in ('private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure,'private.dashboard_admin_live_provider_rows()'::regprocedure,'private.dashboard_admin_wg_payout_config(jsonb,jsonb)'::regprocedure) order by signature`)).rows;assert.deepEqual(after,metadataBefore);
});
test('drifted production body or metadata aborts the migration before any helper is installed',async()=>{
 for(const kind of ['body','acl']){const x=await setup();try{await x.exec(kind==='body'?`create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text) returns text language sql stable security definer set search_path='' as $$select $3$$`:`grant execute on function private.dashboard_admin_wg_payout_config(jsonb,jsonb) to authenticated`);await assert.rejects(x.exec(migration),new RegExp(kind==='body'?'baseline_drift':'metadata_drift'));await x.exec('rollback');assert.equal((await x.query("select to_regprocedure('private.dashboard_admin_wg_provider_aliases()') value")).rows[0].value,null);}finally{await x.close();}}
});
test('real native relation, field types, RLS and required existing index are preflight guards',async()=>{
 const x=await setup();try{
  for(const [change,error]of [
   ['alter table public.wg_recharge_details rename to renamed_source','native_relation_missing'],
   ['alter table public.wg_withdraw_details rename column provider to renamed_provider','native_column_contract'],
   ['alter table public.wg_recharge_details alter column stored_at type timestamp without time zone','native_column_contract'],
   ['alter table public.wg_withdraw_details disable row level security','native_relation_contract'],
   ['drop index public.wg_recharge_site_provider','native_index_contract'],
   ['drop index public.wg_withdraw_site_provider;create index wg_withdraw_site_provider on public.wg_withdraw_details(provider,site_code)','native_index_contract']]){
   await x.exec('begin');await x.exec(change);await assert.rejects(x.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),new RegExp(error));await x.exec('rollback');
   assert.equal((await x.query("select to_regprocedure('private.dashboard_admin_wg_provider_aliases()') value")).rows[0].value,null);
  }
 }finally{await x.close();}
});
