-- Preserve exact member-day semantics while exposing existing AR covering indexes.
-- CLI-generated migration filename aligned with the applied server version.
-- No table/index/data/ACL changes or timeout increases. Provider-filtered AR,
-- NEWAR and other adapters stay byte-identical. Full local-day member dedupe
-- and independent created/success cohorts retain their original semantics.
-- Live baseline prosrc MD5: a782dac792de76230c0155c8000523a7
-- Candidate prosrc MD5: e1c4a724f124658baa9863cc9f2811b1
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $patch$
declare p record; before_metadata jsonb; after_metadata jsonb; definition text; old_fragment text; new_fragment text;
begin
  select p1.* into p from pg_catalog.pg_proc p1
    where p1.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_member_daily(jsonb)');
  if not found then raise exception 'Member-day reader baseline missing'; end if;
  -- Exact known behavioral metadata guard. Catalog OIDs differ across instances;
  -- the existing OID, ACL, owner and every pg_proc attribute are compared below.
  if pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or current_user<>'postgres'
    or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
    or p.prokind<>'f' or p.provolatile<>'s' or not p.prosecdef or p.proretset
    or p.proisstrict or p.proleakproof or p.proparallel<>'u'
    or p.prorettype<>'jsonb'::regtype or p.proargtypes<>'3802'::oidvector
    or p.pronargs<>1 or p.pronargdefaults<>0 or p.proargnames<>array['p_request']::text[]
    or p.proargmodes is not null or p.proallargtypes is not null or p.proargdefaults is not null
    or p.proconfig is distinct from array['search_path=""','jit=off']::text[]
    or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
    or p.probin is not null or p.prosqlbody is not null or p.protrftypes is not null
    or p.proacl::text[] is distinct from array['postgres=X/postgres','authenticated=X/postgres']::text[]
  then raise exception 'Member-day reader metadata changed; review before applying'; end if;
  before_metadata:=pg_catalog.to_jsonb(p)-'prosrc';
  if pg_catalog.md5(p.prosrc)='e1c4a724f124658baa9863cc9f2811b1' then return; end if;
  if pg_catalog.md5(p.prosrc)<>'a782dac792de76230c0155c8000523a7' then
    raise exception 'Member-day reader production body changed; review before applying';
  end if;
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  old_fragment:=$old$    if v_platform.source='ar' then
      v_axis:=case v_basis when 'created' then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.member_id,
          case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
            and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
            else coalesce(nullif(btrim(a.raw_channel),''),$9->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
          $10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and a.order_kind=any(case $6 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4)
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))$q$;end if;
$old$;
  new_fragment:=$new$    if v_platform.source='ar' and v_providers is null then
      -- member_daily_read_performance_v1: expose exact kind/status predicates
      -- to the existing partial covering indexes; keep both event clocks.
      v_axis:=case v_basis when 'created' then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          'charge'::text as direction,a.member_id,null::text as provider,$10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and $6 in ('all','charge') and a.order_kind='recharge'
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4) $charge_success$
        union all
        select '$basis$'::text,a.$axis$ at time zone $4,'withdraw',a.member_id,null::text,$10::text
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and $6 in ('all','withdraw') and a.order_kind='withdraw'
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4) $withdraw_success$
      $q$;
      v_source:=replace(replace(v_source,
        '$charge_success$',case v_basis when 'success' then 'and a.status=''已支付''' else '' end),
        '$withdraw_success$',case v_basis when 'success' then 'and a.status=''已通过''' else '' end);
    elsif v_platform.source='ar' then
      v_axis:=case v_basis when 'created' then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.member_id,
          case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
            and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
            else coalesce(nullif(btrim(a.raw_channel),''),$9->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
          $10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and a.order_kind=any(case $6 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4)
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))$q$;end if;
$new$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
    then raise exception 'Member-day reader source anchor changed';end if;
  execute replace(definition,old_fragment,new_fragment);
  select pg_catalog.to_jsonb(p1)-'prosrc' into after_metadata from pg_catalog.pg_proc p1 where p1.oid=p.oid;
  if after_metadata is distinct from before_metadata
    or (select pg_catalog.md5(p1.prosrc) from pg_catalog.pg_proc p1 where p1.oid=p.oid)<>'e1c4a724f124658baa9863cc9f2811b1'
    then raise exception 'Member-day reader OID, ACL, metadata or expected body drift';end if;
end;
$patch$;
commit;
