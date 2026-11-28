-- Read the captured member note only for an authorized, already paginated
-- order row. Keep it separate from rule labels, grouping, and prepared data.
create or replace function private.withdraw_reason_newar_user_remark(
  p_record_id uuid, p_platform text, p_created_at timestamptz, p_order_number text
) returns text language sql stable security invoker set search_path = '' as $$
  select private.dashboard_admin_order_business_text(d.raw->>'memberNoteLabel')
  from public.newar_detail_records d
  where d.id = p_record_id and d.platform = p_platform and d.dataset = 'withdraw'
    and d.created_at = p_created_at and d.order_number = p_order_number
    and d.raw->>'businessSchemaVersion' = '2'
    and d.raw->>'memberNoteSource' = 'userRemark'
    and jsonb_typeof(d.raw->'memberNoteLabel') = 'string'
$$;
revoke all on function private.withdraw_reason_newar_user_remark(uuid,text,timestamptz,text)
  from public, anon, authenticated, service_role;

-- Preserve the deployed auth, classification, and query plans. Check each
-- splice point before updating its reader so later source changes fail closed.
do $install$
declare
  edit record;
  body text;
begin
  for edit in select * from (values
    ('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)',
     $from$jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text,sort_id) from page$from$,
     $to$jsonb_agg(
    case when v_kind='blockingOrders' then item || jsonb_strip_nulls(jsonb_build_object('userRemark',
      private.withdraw_reason_newar_user_remark(sort_id,v_cfg.platform,sort_time,item->>'orderNumber')))
    else item end order by sort_time desc nulls last,sort_count desc,sort_text,sort_id) from page$to$),
    ('private.withdraw_reason_newar_detail_page(jsonb,jsonb,jsonb,jsonb)',
     $from$'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true)item,created_at,order_no,record_id FROM page$from$,
     $to$'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true) ||
  jsonb_strip_nulls(jsonb_build_object('userRemark',
   private.withdraw_reason_newar_user_remark(record_id,cfg.platform,created_at,order_no))) item,created_at,order_no,record_id FROM page$to$),
    ('private.dashboard_admin_ar_withdraw_with_user_remarks(jsonb)',
     $from$IF p_request->>'kind' IS DISTINCT FROM 'blockingOrders'
     OR result->>'source' IS DISTINCT FROM 'AR 已采集订单'
     OR result->>'basis' IS DISTINCT FROM 'manual_remark'
     OR result->'canViewBlockingOrders' IS DISTINCT FROM 'true'::jsonb$from$,
     $to$IF result->>'source' IS DISTINCT FROM 'AR 已采集订单'
     OR NOT coalesce((p_request->>'kind' = 'blockingOrders' AND result->>'basis' = 'manual_remark'
       AND result->'canViewBlockingOrders' = 'true'::jsonb)
       OR (p_request->>'kind' = 'orders' AND result->>'basis' = 'remark'
       AND result->'canViewOrders' = 'true'::jsonb), false)$to$),
    ('private.dashboard_admin_ar_withdraw_with_user_remarks(jsonb)',
     $from$max(m.user_remark)$from$,
     $to$private.dashboard_admin_order_business_text(max(m.user_remark))$to$)
  ) as edits(signature, before_text, after_text) loop
    body := pg_get_functiondef(edit.signature::regprocedure);
    if strpos(body, edit.after_text) > 0 then continue; end if;
    if length(body) - length(replace(body, edit.before_text, '')) <> length(edit.before_text) then
      raise exception 'Unexpected withdrawal reason reader definition: %', edit.signature;
    end if;
    execute replace(body, edit.before_text, edit.after_text);
  end loop;
end;
$install$;
