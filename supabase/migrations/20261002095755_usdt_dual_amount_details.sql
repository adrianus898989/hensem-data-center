-- Preserve native fiat/USDT fields on already-authorized AR detail pages.
-- Existing aggregates, currency gates, order source and fee formulas are unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function private.dashboard_admin_ar_order_money(p_result jsonb,p_country text,p_platform text)
returns jsonb language sql stable set search_path='' as $money$
 select case when p_country<>'IN' then p_result else jsonb_set(p_result,'{rows}',coalesce((
  select jsonb_agg(r||case when proof.parts is not null and (r->>'amount')::numeric=(proof.parts)[1]::numeric
    and coalesce(nullif(r->>'currency',''),'INR')='INR' and (proof.parts)[2]::numeric>0
   then jsonb_build_object('member_currency','INR','settlement_currency','USDT',
    'settlement_amount',(proof.parts)[3],'exchange_rate',(proof.parts)[2],
    'money_evidence','source_dual_amount_text') else '{}'::jsonb end order by n)
  from jsonb_array_elements(coalesce(p_result->'rows','[]')) with ordinality t(r,n)
  left join public.ar_collected_orders a on a.source_system='AR' and a.country_code=p_country
   and a.platform=p_platform and a.order_kind='recharge' and r->>'direction'='charge'
   and a.order_no=r->>'order_number'
   and md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid::text=r->>'id'
   and btrim(a.raw_channel)~'^USDT[(]TRC20[)]-[0-9]+$'
  left join lateral(select case when length(a.amount_text)<=250 then regexp_match(replace(a.amount_text,chr(92)||'n',chr(10)),
   '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}(?:[.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*([0-9]{1,18}(?:[.][0-9]{1,8})?)[[:space:]]+USDT[：:][[:space:]]*([0-9]{1,18}(?:[.][0-9]{1,8})?)[[:space:]]*$') end parts)proof on true
 ),'[]'::jsonb),true) end;
$money$;
revoke all on function private.dashboard_admin_ar_order_money(jsonb,text,text) from public,anon,authenticated,service_role;
do $patch_dual_money$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;
 p pg_proc%rowtype;metadata jsonb;d text;a text:= $anchor$  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;$anchor$;
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc)<>'e192ebc8fd9947a4f893264e6d15023b' then raise exception 'dual_money_query_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}' or not p.prosecdef
 or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""','jit=off'] then raise exception 'dual_money_query_metadata_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(target);
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'dual_money_query_anchor_drift';end if;
 execute replace(d,a,E'  if v_action=''details'' and v_platform.source=''ar'' then v_result:=private.dashboard_admin_ar_order_money(v_result,v_platform.scope_group,v_platform.source_name);end if;\n'||a);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata then raise exception 'dual_money_query_metadata_changed';end if;
end $patch_dual_money$;
commit;
