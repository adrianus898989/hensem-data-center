// Synthetic fixture only, no production configuration.
const fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const w=__dirname,repo=path.resolve(w,'../..'),migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011154529_ar_withdraw_historical_duration_cache.sql'),'utf8');
async function fixture(){const db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
create table public.ar_collected_orders(source_system text not null,country_code text not null,platform text not null,order_kind text not null,order_no text not null,applied_at timestamp,completed_at timestamp,observed_at timestamptz,status text,operator text,primary key(source_system,country_code,platform,order_kind,order_no));
create table private.test_catalog(source text,scope_group text,country text,name text,source_name text);
create function private.dashboard_admin_live_platforms() returns table(source text,scope_group text,country text,name text,source_name text) language sql stable set search_path='' as $$select * from private.test_catalog$$;
create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$select not s ? 'allow' or s->'allow' @>jsonb_build_array(jsonb_build_array(c,p))$$;
create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable set search_path='' as $$select case upper(btrim($1)) when 'VEER.GAME' then 'VEERGAME' when 'OK.WIN' then 'OKWIN' else upper(btrim($1)) end$$;
grant usage on schema private to anon,authenticated,service_role;`);
const baseline=fs.readFileSync(path.join(repo,'tests/fixtures/ar-withdraw-bounded-projection-production.sql'),'utf8'),patch=fs.readFileSync(path.join(repo,'supabase/migrations/20261011153419_ar_withdraw_bounded_projection_auto_lane.sql'),'utf8');let ar=baseline;for(const i of [0,1])ar=ar.replace(patch.match(new RegExp('\\$old'+i+'\\$([\\s\\S]*?)\\$old'+i+'\\$'))[1],patch.match(new RegExp('\\$new'+i+'\\$([\\s\\S]*?)\\$new'+i+'\\$'))[1]);await db.exec(ar);await db.exec('revoke all on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) from public,anon,authenticated,service_role;');await db.exec(migration);return db;}
module.exports={fixture,migration};
