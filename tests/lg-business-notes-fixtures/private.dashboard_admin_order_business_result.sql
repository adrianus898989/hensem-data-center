CREATE OR REPLACE FUNCTION private.dashboard_admin_order_business_result(p_result jsonb, p_source text, p_country text, p_platform text, p_platform_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$
