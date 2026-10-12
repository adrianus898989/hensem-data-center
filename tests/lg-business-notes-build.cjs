// Rebuild exact guarded patches from read-only production snapshots. No network.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),md5=s=>createHash('md5').update(s).digest('hex');
const metadata=JSON.parse(read('tests/lg-business-notes-fixtures/security-metadata.json'));
const patches=[];
const reasonOld=" if v_meta.source='ar' then";
const reasonNew=` -- lg_business_notes_v1: original request, authorization and native catalog checks ran above.
 if v_meta.source='lg' then
  v_rows:=private.dashboard_admin_lg_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
${reasonOld}`;
patches.push(['dashboard_admin_live_withdraw_reasons',reasonOld,reasonNew]);
const autoOld=' return v_result;';
const autoNew=` -- lg_business_notes_metadata_v1: only tag existing rows with an exact authorized native LG identity.
 with lg_catalog as materialized (select p.* from private.dashboard_admin_live_platforms() p where p.source='lg'),
 tagged as (select x.ordinality,x.value||case when exists(select 1 from lg_catalog p
  where p.country=x.value->>'country' and private.dashboard_scope_allows(v_scope,p.scope_group,p.source_name)
   and private.dashboard_admin_live_withdraw_key(x.value->>'platform')=any(array[private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name)]))
  then jsonb_build_object('reasonAvailable',true,'sourceNotesAvailable',true,'sourceNoteFormat','lg_business_notes_v1') else '{}'::jsonb end value
  from jsonb_array_elements(v_result->'rows') with ordinality x)
 select jsonb_set(v_result,'{rows}',coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)) into v_result from tagged;
${autoOld}`;
patches.push(['dashboard_admin_live_auto_withdraw',autoOld,autoNew]);
const business=read('tests/lg-business-notes-fixtures/private.dashboard_admin_order_business_result.sql');
const businessOld=business.slice(business.indexOf("  if r->>'direction'='withdraw' then"),business.indexOf("   elsif p_source='duoli'")+"   elsif p_source='duoli'".length);
const businessNew=`  if p_source='lg' and r->>'direction' in('withdraw','charge') then
   with source_order as materialized (
    select d.operator_name,d.operator_kind,d.finished_at,d.handle_seconds,
     private.dashboard_admin_lg_business_notes(d.raw) notes,private.dashboard_admin_lg_business_fields(d.raw) business_fields
    from public.lg_orders d where d.source_system='LG' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind=case r->>'direction' when 'withdraw' then 'withdraw' else 'recharge' end and d.order_no=r->>'order_number'
   )
   select (case when r->>'direction'='withdraw' then jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator_name),
    'operator_class',case when d.operator_kind in('auto','manual') then d.operator_kind end,
    'processing_completed_at',d.finished_at,'processing_duration_seconds',case when d.handle_seconds>=0 then d.handle_seconds end,
    'processing_time_basis','source_processing','processing_method_available',true) else '{}'::jsonb end)
    ||jsonb_build_object('lg_remark',d.notes#>'{sourceNotes,remark}','lg_remark_state',d.notes#>'{sourceNoteStates,remark}',
     'lg_app_remark',d.notes#>'{sourceNotes,appRemark}','lg_app_remark_state',d.notes#>'{sourceNoteStates,appRemark}',
     'source_business_fields',d.business_fields) into b from source_order d;
  elsif r->>'direction'='withdraw' then
   if p_source='duoli'`;
patches.push(['dashboard_admin_order_business_result',businessOld,businessNew]);
function patch(name,old,addition){
 const base=read('tests/lg-business-notes-fixtures/private.'+name+'.sql'),meta=metadata.find(x=>x.function_name===name);
 assert.equal(base.split(old).length,2,name+' unique anchor');
 const before=base.split('AS $function$')[1].split('$function$')[0],after=before.replace(old,addition);
 assert.equal(md5(before),meta.prosrc_md5);
 const defAfter=base.replace(old,addition).trimEnd()+'\n';
 return `do $patch_${name}$
declare p record;d text;before_meta jsonb;
begin
 select * into p from pg_proc where oid='${meta.signature}'::regprocedure;
 if md5(p.prosrc) not in('${meta.prosrc_md5}','${md5(after)}') or md5(pg_get_functiondef(p.oid)) not in('${meta.definition_md5}','${md5(defAfter)}')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from ${meta.prosecdef}
  or p.provolatile<>'s' or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '${meta.proacl}'
  then raise exception 'lg_business_${name}_contract_drift';end if;
 if md5(p.prosrc)='${md5(after)}' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old$${old}$old$,'')))/length($old$${old}$old$)<>1 then raise exception 'lg_business_anchor_drift';end if;
 d:=replace(d,$old$${old}$old$,$new$${addition}$new$);execute d;
 select * into p from pg_proc where oid='${meta.signature}'::regprocedure;
 if md5(p.prosrc)<>'${md5(after)}' or to_jsonb(p)-'prosrc' is distinct from before_meta then raise exception 'lg_business_postcondition';end if;
end $patch_${name}$;
`;
}
let sql=read('supabase/admin-live-lg-business-notes.sql');
sql=sql.replace(/-- LG_PATCHES[\s\S]*?commit;/,'-- LG_PATCHES\n'+patches.map(x=>patch(...x)).join('\n')+'commit;');
const helperSpecs=[['dashboard_admin_lg_business_notes(jsonb)','$lg_note$','i'],['dashboard_admin_lg_business_fields(jsonb)','$lg_fields$','i'],['dashboard_admin_lg_withdraw_reasons(jsonb,jsonb,jsonb)','$lg_notes$','s']];
const helperChecks=helperSpecs.map(([sig,delimiter,vol])=>{
 const body=sql.split('as '+delimiter)[1].split(delimiter)[0];return `
 if to_regprocedure('private.${sig}') is not null then
 select * into p from pg_proc where oid=to_regprocedure('private.${sig}');
 if md5(p.prosrc)<>'${md5(body)}' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'${vol}'
  or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'lg_business_helper_drift';end if;end if;`;
}).join('\n');
const receiver=read('supabase/lg-business-notes-receiver.sql'),safe=receiver.split("as $fn$")[1].split('$fn$')[0];
const guard=`-- LG_HELPER_GUARD
do $helper_guard$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.lg_business_note_safe(text)');
 if p.oid is null or md5(p.prosrc)<>'${md5(safe)}' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'lg_business_sanitizer_drift';end if;
${helperChecks}
end $helper_guard$;
`;
sql=sql.replace(/-- LG_HELPER_GUARD[\s\S]*?(?=create or replace function private.dashboard_admin_lg_business_notes)/,guard);
if(require.main===module){
 fs.writeFileSync(path.join(root,'supabase/admin-live-lg-business-notes.sql'),sql);
 fs.writeFileSync(path.join(root,'supabase/migrations/20261012133326_lg_business_notes_reader.sql'),sql);
}
module.exports={patches};
