// Isolated synthetic Postgres; no production connection or order data.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
const id='10000000-0000-0000-0000-000000000001';
const hidden='10000000-0000-0000-0000-000000000002';
let db;
const expand=async request=>(await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) result',[JSON.stringify(request)])).rows[0].result;
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema private;create role anon;create role authenticated;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],primary key(country,platform,raw_provider));
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,primary key(country,platform,raw_provider));
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
  if current_setting('test.auth',true)='denied' then raise exception 'preview_denied'; end if;
  return '{"mode":"selected","countries":["印度"],"platforms":["EXAMPLE","SOURCE"]}';end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->'countries' ? c and s->'platforms' ? p$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,country text,name text,source_name text) language plpgsql stable as $$begin
  perform private.dashboard_admin_live_scope();
  if current_setting('test.catalog_must_not_run',true)='yes' then raise exception 'unexpected_catalog';end if;
  return query select '${id}'::uuid,'印度'::text,'EXAMPLE'::text,'SOURCE'::text;end$$;
 create function private.dashboard_admin_live_provider_rows() returns table(raw_provider text) language plpgsql stable as $$begin raise exception 'full_registry_scan_forbidden';end$$;
 insert into private.dashboard_admin_provider_registry values
 ('印度','EXAMPLE','WandaPay-QR',array['WandaPay-QR']),('印度','SOURCE','QR-TyPay3',array['QR-TyPay3']),
 ('印度','EXAMPLE','raw-override',array['OldPay']),('印度','EXAMPLE','',array['人工确认']),
 ('印度','EXAMPLE','conflict',array['WandaPay','TimiPay']),('印度','EXAMPLE','fresh-alias',array['WandaPay','WandaPay-QR']),
 ('印度','OTHER','must-not-appear',array['WandaPay']),('尼泊尔','EXAMPLE','cross-country',array['WandaPay']);
 insert into private.dashboard_admin_provider_overrides values('印度','EXAMPLE','raw-override','WandaPay-QR');
 `);
 await db.exec(sql('admin-live-provider-aliases.sql'));
 const configuration=sql('admin-live-configuration.sql');
 await db.exec(configuration.slice(
  configuration.indexOf('create or replace function private.dashboard_admin_live_provider_alias_values('),
  configuration.indexOf('create or replace function private.dashboard_admin_live_provider_rows(')
  ));
 await db.exec(sql('admin-live-provider-filter-performance.sql'));
});
after(async()=>db?.close());
test('absent, null and empty provider filters return without catalog or registry work',async()=>{
 await db.exec("select set_config('test.catalog_must_not_run','yes',false)");
 try{for(const request of [null,{platformId:id},{platformId:id,providers:null},{platformId:id,providers:[]}])assert.deepEqual(await expand(request),request);}
 finally{await db.exec("select set_config('test.catalog_must_not_run','no',false)");}
});
test('canonical filters expand raw QR aliases and overrides only inside the authorized platform',async()=>{
 const r=await expand({platformId:id,providers:['WandaPay','TyPay3']});
 assert.deepEqual(r.providers,['QR-TyPay3','TyPay3','WandaPay','WandaPay-QR','fresh-alias','raw-override']);
 assert(!r.providers.includes('must-not-appear'));assert(!r.providers.includes('cross-country'));assert(!r.providers.includes('conflict'));
});
test('new typed provider aliases have SQL/browser parity and preserve scoped filter identities',async()=>{
 const vm=require('node:vm'),ctx={};ctx.window=ctx;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-provider-aliases.js'),'utf8'),ctx);
 const cases=[['T3Pay唤醒','T3Pay'],['t3pay','T3Pay'],['3TPay唤醒','3TPay'],['RushPay唤醒','RushPay'],['RushPay跑分','RushPay'],['RushPay-QR (唤醒)','RushPay'],['LovePay','WPay'],['HaoxPay — QR【跑分】','WPay'],['free2pay唤醒','FreePay'],['FREEPAY','FreePay'],['TtPay','TTPay'],['Independent7Pay (跑分)（唤醒）','Independent7Pay'],['T3Pay唤醒服务','T3Pay唤醒服务'],['唤醒','唤醒'],['FreePay2','FreePay2']];
 for(const country of ['印度','IN','香港','RED_CRAB']){
  const result=await db.query('select raw,private.dashboard_admin_live_provider_alias($1,raw) canonical from unnest($2::text[])raw',[country,cases.map(x=>x[0])]);
  result.rows.forEach((r,i)=>{assert.equal(r.canonical,cases[i][1],country+'/'+r.raw);assert.equal(r.canonical,ctx.HensemProviderNames.canonical(r.raw,country))});
 }
 await db.exec(`insert into private.dashboard_admin_provider_registry values
  ('印度','EXAMPLE','T3Pay唤醒',array['T3Pay唤醒']),('印度','EXAMPLE','3TPay唤醒',array['3TPay唤醒']),
  ('印度','EXAMPLE','RushPay唤醒',array['RushPay唤醒']),('印度','SOURCE','RushPay跑分',array['RushPay跑分']),
  ('印度','EXAMPLE','HaoxPay-QR',array['HaoxPay-QR']),('印度','EXAMPLE','LovePay',array['LovePay']),
  ('印度','EXAMPLE','free2pay唤醒',array['free2pay唤醒']),('印度','EXAMPLE','ttPAY',array['ttPAY']),
  ('印度','OTHER','OTHER-T3',array['T3Pay唤醒']);`);
 assert.deepEqual((await expand({platformId:id,providers:['T3Pay']})).providers,['T3Pay','T3Pay唤醒']);
 assert.deepEqual((await expand({platformId:id,providers:['RushPay']})).providers,['RushPay','RushPay唤醒','RushPay跑分']);
 assert.deepEqual((await expand({platformId:id,providers:['WPay']})).providers,['HaoxPay-QR','LovePay','WPay']);
 assert.deepEqual((await expand({platformId:id,providers:['FreePay','TTPay']})).providers,['FreePay','TTPay','free2pay唤醒','ttPAY']);
 const privileges=(await db.query("select has_function_privilege('anon','private.dashboard_admin_live_provider_alias(text,text)','EXECUTE') anon,has_function_privilege('authenticated','private.dashboard_admin_live_provider_alias(text,text)','EXECUTE') authenticated")).rows[0];
 assert.deepEqual(privileges,{anon:false,authenticated:false});
});
test('the actual server aggregation merges aliases once before ratios without crossing dates or directions',async()=>{
 const config=sql('admin-live-configuration.sql'),query=sql('admin-live-configuration-query.sql');
 await db.exec(config.slice(config.indexOf('create or replace function private.dashboard_admin_live_provider_canonical('),config.indexOf('create or replace function private.dashboard_admin_live_configuration_access(')));
 await db.exec(query.slice(query.indexOf('create or replace function private.dashboard_admin_live_remap_groups('),query.indexOf('create or replace function private.dashboard_admin_live_expand_provider_filter(')));
 const base={currency:'INR',direction:'charge',date:'2026-09-25',all_amount:'100',all_count:10,success_amount:'80',success_count:8,created_success_count:7,pending_amount:'20',pending_count:2,failed_amount:'0',failed_count:0,rejected_amount:'0',rejected_count:0,unknown_amount:'0',unknown_count:0,missing_amount_count:0,negative_amount_count:0};
 const rows=[{...base,provider:'RushPay唤醒'},{...base,provider:'RushPay跑分'},{...base,provider:'RushPay',date:'2026-09-24'},{...base,provider:'RushPay',direction:'withdraw'},{...base,provider:'T3Pay唤醒'},{...base,provider:'3TPay唤醒'}],before=structuredClone(rows);
 const result=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) rows',[JSON.stringify(rows),'印度','EXAMPLE'])).rows[0].rows;
 assert.equal(result.length,5);const merged=result.find(r=>r.provider==='RushPay'&&r.direction==='charge'&&r.date==='2026-09-25');
 assert.equal(Number(merged.success_amount),160);assert.equal(merged.success_count,16);assert.equal(merged.all_count,20);
 assert.equal(result.reduce((n,r)=>n+r.success_count,0),48);assert.equal(result.reduce((n,r)=>n+Number(r.success_amount),0),480);
 assert.equal(result.filter(r=>r.provider==='T3Pay').length,1);assert.equal(result.filter(r=>r.provider==='3TPay').length,1);assert.deepEqual(rows,before);
 const again=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) rows',[JSON.stringify(result),'印度','EXAMPLE'])).rows[0].rows;assert.deepEqual(again,result);
});
test('UI select-all array remains a single-platform raw filter and preserves manual and unknown choices',async()=>{
 const r=await expand({platformId:id,providers:['WandaPay','TyPay3','人工确认','未识别通道']});
 for(const name of ['WandaPay-QR','QR-TyPay3','人工确认','未识别通道'])assert(r.providers.includes(name));
 assert(!r.providers.includes('must-not-appear'));assert(!r.providers.includes('cross-country'));
});
test('conflicting canonical names do not silently become one provider',async()=>{
 const r=await expand({platformId:id,providers:['WandaPay']});assert(!r.providers.includes('conflict'));assert(r.providers.includes('fresh-alias'));
});
test('unauthorized platform and malformed identifiers cannot read registry aliases',async()=>{
 for(const platformId of [hidden,'bad-id',null]){const q={platformId,providers:['WandaPay']};assert.deepEqual(await expand(q),q);}
 await db.exec("select set_config('test.auth','denied',false)");
 try{await assert.rejects(()=>expand({platformId:id,providers:['WandaPay']}),/preview_denied/);}
 finally{await db.exec("select set_config('test.auth','allowed',false)");}
});
test('malformed and oversized selected arrays are rejected before directory evaluation',async()=>{
 for(const providers of [[null],[2],[''],['bad\nvalue'],Array.from({length:201},()=> 'WandaPay')])await assert.rejects(()=>expand({platformId:id,providers}),/invalid_filter/);
});
test('no-filter shortcut does not bypass the downstream raw-engine authentication',async()=>{
 await db.exec(`create function private.test_full_query(q jsonb) returns jsonb language plpgsql stable as $$declare expanded jsonb;begin expanded:=private.dashboard_admin_live_expand_provider_filter(q);perform private.dashboard_admin_live_scope();return expanded;end$$;select set_config('test.auth','denied',false)`);
 try{await assert.rejects(()=>db.query('select private.test_full_query($1::jsonb)',[JSON.stringify({platformId:id})]),/preview_denied/);}
 finally{await db.exec("select set_config('test.auth','allowed',false)");}
});
test('patch keeps lookup bounded before normalization and grants no anonymous execution',()=>{
 const patch=sql('admin-live-provider-filter-performance.sql');
 assert.match(patch,/coalesce\(jsonb_typeof\(p_request->'providers'\),'null'\)/);
 assert.match(patch,/with scoped as materialized[\s\S]*r\.country=v_platform\.country[\s\S]*normalized as materialized/);
 assert.match(patch,/private\.dashboard_scope_allows\(v_scope,r\.country,r\.platform\)/);
 assert.doesNotMatch(patch,/from private\.dashboard_admin_live_provider_rows\(/);
 assert.match(patch,/revoke all[\s\S]*from public,anon/);
});
