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
