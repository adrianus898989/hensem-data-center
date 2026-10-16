// Deployment-only replacement of four already installed helpers; no connection,
// table recreation, source data, credentials, or production mutation is performed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const installed=JSON.parse(read('tests/fixtures/yash-channel-shadow-installed-refresh.json'));
const source=read('supabase/operations/yash-channel-shadow-stage.sql');
function definition(name){const start=source.indexOf('create function private.'+name+'(');if(start<0)throw Error('Missing replacement '+name);const tail=source.slice(start),m=tail.match(/as\s+(\$[a-z_]*\$)/i),end=tail.indexOf(m[1]+';',m.index+m[0].length);if(end<0)throw Error('Missing function terminator');return {sql:tail.slice(0,end+m[1].length+1).replace(/^create function /,'create or replace function '),hash:crypto.createHash('md5').update(tail.slice(m.index+m[0].length,end)).digest('hex')};}
function patch(){
 const replacements=installed.map(x=>({...x,...definition(x.name)}));
 const contracts=JSON.stringify(replacements.map(x=>({signature:x.signature,before:x.bodyHash,after:x.hash})));
 return `-- Manifest-only staging upgrade. Existing staging must be empty; old heads remain untouched.
begin;
set local statement_timeout='15s';set local lock_timeout='500ms';
do $guard$
declare spec jsonb;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 lock table private.yash_channel_shadow_batches,private.yash_channel_shadow_items in access exclusive mode;
 if exists(select 1 from private.yash_channel_shadow_batches)or exists(select 1 from private.yash_channel_shadow_items)then raise exception 'yash_shadow_patch_requires_empty_stage';end if;
 for spec in select value from jsonb_array_elements('${contracts}'::jsonb)loop
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure(spec->>'signature')and md5(p.prosrc)in(spec->>'before',spec->>'after')
    and pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.provolatile='v'
    and p.proconfig=array['search_path=""']and p.prorettype='jsonb'::regtype
    and p.proacl::text='{postgres=X/postgres}'and l.lanname='plpgsql')
   then raise exception 'yash_shadow_installed_helper_changed: %',spec->>'signature';end if;
 end loop;
end;$guard$;
${replacements.map(x=>x.sql+'\nrevoke all on function '+x.signature+' from public,anon,authenticated,service_role;').join('\n\n')}
do $verify$
declare spec jsonb;
begin
 for spec in select value from jsonb_array_elements('${contracts}'::jsonb)loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(spec->>'signature')and md5(p.prosrc)=spec->>'after'
   and pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.provolatile='v'
   and p.proconfig=array['search_path=""']and p.proacl::text='{postgres=X/postgres}')
  then raise exception 'yash_shadow_replacement_mismatch: %',spec->>'signature';end if;
 end loop;
end;$verify$;
commit;
`;
}
module.exports={patch};
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node scripts/ops/build-yash-stage-refresh-patch.cjs OUTPUT.sql');fs.writeFileSync(out,patch());process.stdout.write(path.resolve(out)+'\n');}
