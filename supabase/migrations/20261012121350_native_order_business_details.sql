begin;
set local lock_timeout='5s';set local statement_timeout='30s';
-- Enrich only the already authorized, bounded result page. No new scan, counts,
-- source writes or success-time substitution. Raw payloads never leave SQL.
create or replace function private.dashboard_admin_order_business_text(v text)
returns text language sql immutable security invoker set search_path='' as $$
 select nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(coalesce(v,''),'0x[a-f0-9]{40}|(bc1|tb1)[a-z0-9]{20,90}|\mT[1-9A-HJ-NP-Za-km-z]{33}\M','[已移除地址]','gi'),'https?://[^[:space:]]+','[已移除链接]','gi'),
  '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}','[已移除邮箱]','gi'),
  '[+]?[0-9][0-9 ().-]{5,}[0-9]','[已移除号码]','g'),
  '[[:cntrl:]]',' ','g')),256),'');
$$;
revoke all on function private.dashboard_admin_order_business_text(text) from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_order_business_result(p_result jsonb,p_source text,p_country text,p_platform text,p_platform_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r jsonb;b jsonb;out_rows jsonb:='[]';
begin
 if p_source not in ('ar','lg','newar','duoli','kb','game66') or not(p_result?'rows') then return p_result;end if;
 if jsonb_typeof(p_result->'rows')<>'array' or jsonb_array_length(p_result->'rows')>500 then raise exception 'business_detail_page_invalid';end if;
 for r in select value from jsonb_array_elements(p_result->'rows') loop
  b:=null;
  if r->>'direction'='withdraw' then
   if p_source='lg' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator_name),
     'operator_class',case when d.operator_kind in('auto','manual') then d.operator_kind end,
     'processing_completed_at',d.finished_at,'processing_duration_seconds',case when d.handle_seconds>=0 then d.handle_seconds end,
     'processing_time_basis','source_processing','processing_method_available',true)
    into b from public.lg_orders d where d.source_system='LG' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind='withdraw' and d.order_no=r->>'order_number';
   elsif p_source='duoli' and p_country='ID' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator),
     'audit_completed_at',d.audit_completed_at,'audit_duration_seconds',case when d.audit_duration_seconds>=0 and d.audit_completed_at>=d.created_at and d.audit_completed_at<=d.observed_at then d.audit_duration_seconds end,
     'processing_time_basis','source_reported_audit_duration','processing_method_available',false)
    into b from private.duoli_order_details d where d.country='ID' and d.system_name='DOLI' and d.platform=p_platform
     and d.business='withdraw' and d.created_at=(r->>'created_at')::timestamptz
     and md5(jsonb_build_array('DOLI',d.platform,d.business,d.source_order_id)::text)::uuid=(r->>'id')::uuid;
   elsif p_source='newar' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(f.account),
     'operator_class',f.method,'processing_submitted_at',f.submitted_at,'processing_completed_at',f.handled_at,
     'processing_duration_seconds',case when isfinite(f.submitted_at) and isfinite(f.handled_at) and f.handled_at>=f.submitted_at
      and f.handled_at<=d.captured_at+interval '5 minutes' then extract(epoch from f.handled_at-f.submitted_at) end,
     'processing_time_basis','source_processing','processing_method_available',true,
     'automatic_business_note',case when d.raw->>'businessSchemaVersion'='2' and d.raw->>'automaticReasonSource'='remark' and jsonb_typeof(d.raw->'automaticReasonLabel')='string'
       then private.dashboard_admin_order_business_text(d.raw->>'automaticReasonLabel') end,
     'member_business_note',case when d.raw->>'businessSchemaVersion'='2' and d.raw->>'memberNoteSource'='userRemark' and jsonb_typeof(d.raw->'memberNoteLabel')='string'
       then private.dashboard_admin_order_business_text(d.raw->>'memberNoteLabel') end)
    into b from public.newar_detail_records d left join private.newar_withdraw_facts f on f.record_id=d.id and f.platform=d.platform
     where d.id=(r->>'id')::uuid and d.platform=p_platform and d.dataset='withdraw' and d.order_number=r->>'order_number';
   elsif p_source='ar' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator),'processing_method_available',false)
    into b from public.ar_collected_orders d where d.source_system='AR' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind='withdraw' and d.order_no=r->>'order_number';
   elsif p_source='kb' and p_country='IN' and p_platform='YASH.BET' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator),'processing_method_available',false)
    into b from private.yash_orders d where d.source_site='yash' and d.order_type='withdrawal' and d.order_no=r->>'order_number';
   elsif p_source='game66' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(coalesce(nullif(btrim(d.audit_admin),''),nullif(btrim(d.lock_admin),''),nullif(btrim(d.lock_user_admin),''))),
     'source_audit_mode',case when d.auto_commit in('0','1','2') then d.auto_commit end,'processing_method_available',false)
    into b from public.game66_withdraw_orders d where d.platform_id=p_platform_id and d.id=(r->>'id')::uuid and d.order_num=r->>'order_number';
   end if;
  end if;
  out_rows:=out_rows||jsonb_build_array(r||coalesce(b,'{}'::jsonb));
 end loop;
 return jsonb_set(p_result,'{rows}',out_rows);
end;
$$;
revoke all on function private.dashboard_admin_order_business_result(jsonb,text,text,text,uuid) from public,anon,authenticated,service_role;

do $patch$
declare sig text;p record;before_meta jsonb;definition text;
 anchor text:=$a$  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;$a$;
 addition text:=$a$
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);$a$;
begin
 foreach sig in array array['private.dashboard_admin_live_query_raw(jsonb)','private.dashboard_admin_live_drilldown_raw(jsonb)','private.dashboard_admin_live_analysis_orders_raw(jsonb)'] loop
  select * into strict p from pg_proc where oid=to_regprocedure(sig);
  if pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s'
   or p.proconfig is distinct from array['search_path=""','jit=off']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or md5(p.prosrc)<>(case when p.proname='dashboard_admin_live_query_raw' then 'd15ed50d64563efd2d5a13ceb47bf9a7' when p.proname='dashboard_admin_live_drilldown_raw' then 'aedac8e0b599492bd65f44d83573c377' else '1435201b5ebcb49e17011d4f09a2fa7c' end)
   then raise exception 'order_business_reader_baseline_drift: %',sig;end if;
  before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'order_business_reader_anchor_drift: %',sig;end if;
  execute replace(definition,anchor,anchor||case when p.proname='dashboard_admin_live_analysis_orders_raw' then E'\n  if v_platform.source=''wg'' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;' else '' end||addition);
  if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta then raise exception 'order_business_reader_metadata_drift: %',sig;end if;
 end loop;
end;$patch$;

notify pgrst,'reload schema';
commit;
