// Offline generation from read-only function definitions; never connects to a database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),md5=s=>createHash('md5').update(s).digest('hex');
const meta=JSON.parse(read('tests/fixtures/duoli-source-notes-reader/metadata.json'));
const old=" if v_meta.source='ar' then";
const addition=` -- duoli_source_notes_v1: validated request, live authorization and native directory above.
 if v_meta.source='duoli' then
  v_rows:=private.duoli_withdraw_source_notes(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
${old}`;
const sig='private.dashboard_admin_live_withdraw_reasons(jsonb)',base=read('tests/fixtures/duoli-source-notes-reader/'+sig.split('(')[0]+'.sql');
assert.equal(base.split(old).length,2,'unique post-authorization native branch');
const before=base.split('AS $function$')[1].split('$function$')[0],after=before.replace(old,addition);
assert.equal(md5(before),meta.find(x=>x.signature===sig).body_md5);
function guard(x,optional=false){const m=x.metadata,hashes=x.hashes||[x.body_md5];return `
 select * into p from pg_proc where oid=to_regprocedure('${x.signature}');
 if ${optional?'p.oid is not null and (':'p.oid is null or ('}md5(p.prosrc) not in(${hashes.map(h=>"'"+h+"'").join(',')})
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from ${m.prosecdef}
  or p.provolatile<>'${m.provolatile}' or p.proparallel<>'u' or p.procost<>100 or p.proretset or p.proisstrict or p.proleakproof
  or p.prokind<>'f' or p.pronargdefaults<>${m.pronargdefaults||0} or p.provariadic<>0 or p.prorettype<>'${x.returnType||'jsonb'}'::regtype
  ${x.arguments?"or pg_get_function_arguments(p.oid) is distinct from '"+x.arguments.replaceAll("'","''")+"'":''}
  or p.prolang<>(select oid from pg_language where lanname='${x.language||'plpgsql'}')
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{${m.proacl.join(',')}}') then raise exception 'duoli_source_notes_contract_drift: ${x.signature}';end if;`;}
const code=read('supabase/admin-live-duoli-source-notes.sql');
const helpers=[['private.duoli_source_note_field(jsonb,text)','$duoli_field$','i','p_field jsonb, p_state text'],['private.duoli_withdraw_source_notes(jsonb,jsonb,jsonb)','$duoli_notes$','s','p_request jsonb, p_scope jsonb, p_meta jsonb']].map(([signature,delim,vol,args])=>({signature,arguments:args,body_md5:md5(code.split('as '+delim)[1].split(delim)[0]),metadata:{prosecdef:false,provolatile:vol,proacl:['postgres=X/postgres']}}));
const specs=meta.map(x=>({...x,arguments:read('tests/fixtures/duoli-source-notes-reader/'+x.signature.split('(')[0]+'.sql').split('\n')[0].match(/\((.*)\)$/)[1],hashes:x.signature===sig?[x.body_md5,md5(after)]:[x.body_md5],returnType:x.signature===sig?'jsonb':x.signature.includes('_status(')||x.signature.includes('_business_text(')?'text':x.signature.includes('_amount(')?'numeric':'boolean',language:x.signature.includes('_status(')||x.signature.includes('_business_text(')||x.signature.includes('_detail_keys(')?'sql':'plpgsql'}));
const sql=`-- Source-field evidence reader only. No collector, statistics or table writes.
begin;
set local lock_timeout='500ms';
set local statement_timeout='5s';
do $guard$ declare p record;begin
 if current_user<>'postgres' then raise exception 'duoli_source_notes_install_denied';end if;
${specs.map(x=>guard(x)).join('')}
${helpers.map(x=>guard(x,true)).join('')}
 if not exists(select 1 from pg_class c where c.oid=to_regclass('private.duoli_order_business_notes_v1') and c.relrowsecurity)
  or has_table_privilege('authenticated','private.duoli_order_business_notes_v1','select')
  or has_table_privilege('anon','private.duoli_order_business_notes_v1','select')
  or has_table_privilege('service_role','private.duoli_order_business_notes_v1','select') then raise exception 'duoli_source_notes_table_contract_drift';end if;
end $guard$;
${code}
do $patch$ declare p record;d text;before_meta jsonb;begin
 select * into p from pg_proc where oid='${sig}'::regprocedure;
 if md5(p.prosrc)='${md5(after)}' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 d:=replace(d,$anchor$${old}$anchor$,$addition$${addition}$addition$);execute d;
 select * into p from pg_proc where oid='${sig}'::regprocedure;
 if md5(p.prosrc)<>'${md5(after)}' or to_jsonb(p)-'prosrc' is distinct from before_meta then raise exception 'duoli_source_notes_patch_postcondition';end if;
end $patch$;
commit;
`;
if(require.main===module)fs.writeFileSync(path.join(root,'supabase/migrations/20261016053345_duoli_source_notes_reader.sql'),sql);
module.exports={sql,old,addition,helpers};
