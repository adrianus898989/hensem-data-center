const fs=require('node:fs'),path=require('node:path');const{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');const migration=path.join(root,'supabase/migrations/20261015061212_provider_published_snapshot_shadow.sql');
async function setup({protocol=true}={}){const db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'provider-snapshot-foundation.sql'),'utf8'));await db.exec(fs.readFileSync(migration,'utf8'));
if(protocol){
// Explicit synthetic authorization catalog only, after the REAL installer has
// validated original captured production definitions. Tests below exercise the
// actual role/gateway/scope bodies with synthetic users, never real JWTs.
await db.exec(`create or replace function private.dashboard_admin_live_platforms()returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
language plpgsql stable security definer set search_path=''as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select p.*from private.test_native_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end;$$;
`);
// Preserve the REAL installed-copy guard. Only its expected catalog body is
// adjusted to the explicit synthetic authorized catalog above; all original
// raw/remap/submission/intake and all six kernel metadata stay exact.
const def=(await db.query("select pg_get_functiondef('private.provider_snapshot_kernel_contract_current()'::regprocedure)value")).rows[0].value;
const match=def.match(/\$expected\$([\s\S]*?)\$expected\$::jsonb/);if(!match)throw Error('missing fixture contract');
const expected=JSON.parse(match[1]);expected.find(x=>x.signature==='private.dashboard_admin_live_platforms()').body_md5=(await db.query("select md5(prosrc)value from pg_proc where oid='private.dashboard_admin_live_platforms()'::regprocedure")).rows[0].value;
await db.exec(def.replace(match[1],JSON.stringify(expected)));
}return db;}
module.exports={setup,migration};
