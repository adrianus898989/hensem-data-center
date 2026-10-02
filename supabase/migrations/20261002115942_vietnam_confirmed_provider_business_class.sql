-- Confirmed AR VN identity and native WG internal-transfer business class.
-- Native channels/types/amounts remain untouched; no new sites or pricing versions.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$
declare r record;p pg_proc%rowtype;
begin
 if to_regprocedure('private.dashboard_admin_live_confirmed_provider(text,text,text)') is not null then raise exception 'vn_confirmed_provider_already_exists';end if;
 for r in select * from(values
 ('private.dashboard_admin_live_provider_canonical(text,text,text)','a785d9016309de404b385eb700637247',true,'s','{postgres=X/postgres}'),
 ('private.dashboard_admin_live_expand_provider_filter(jsonb)','d6759f66ba792b45fe657bc8679651bd',true,'s','{postgres=X/postgres,authenticated=X/postgres}'),
 ('private.dashboard_admin_live_provider_rows()','ae6365c65e66cbb1f9caf637e918564e',true,'s','{postgres=X/postgres}'),
 ('private.dashboard_admin_live_confirmed_usdt_provider(text,text)','872eb424bf09ecd9d5a144d505ed7712',false,'i','{postgres=X/postgres}'),
 ('private.dashboard_admin_live_provider_options(jsonb)','d2f604f8cfb555f74123c578f55d93e8',true,'s','{postgres=X/postgres,authenticated=X/postgres}'),
 ('private.dashboard_admin_live_workorder_provider_batch(jsonb)','75c8661f961e5e8423c523970a44244f',false,'s','{postgres=X/postgres}'),
 ('private.dashboard_admin_wg_order_source(text,boolean)','bd65573ebf63e112f91edcc62d310689',false,'i','{postgres=X/postgres}'),
 ('private.dashboard_admin_live_query_raw(jsonb)','7b096f2ec23ad7bc280675351224cb9c',true,'s','{postgres=X/postgres}'),
 ('private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)','4ac16874975fb1d6987fd8c8e4ffa536',true,'s','{postgres=X/postgres}')) t(signature,body_hash,definer,volatility,acl) loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc) is distinct from r.body_hash then raise exception 'vn_provider_baseline_drift: %',r.signature;end if;
  if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from r.acl or p.prosecdef is distinct from r.definer or p.provolatile::text is distinct from r.volatility or p.proconfig is distinct from (case when r.signature='private.dashboard_admin_live_query_raw(jsonb)' then array['search_path=""','jit=off'] else array['search_path=""'] end) then raise exception 'vn_provider_metadata_drift: %',r.signature;end if;
 end loop;
end;
$guard$;
create function private.dashboard_admin_live_confirmed_provider(p_country text,p_platform text,p_raw text)
 returns text language sql immutable set search_path='' as $confirmed$
 select case when p_country in ('VN','越南') and p_platform in ('66CLUB','82VN','92LOTTERY','VN168')
   and btrim(p_raw)='Tron-USDT' then 'TronPayUSDT'
   else private.dashboard_admin_live_confirmed_usdt_provider(p_country,p_raw) end;
$confirmed$;
revoke all on function private.dashboard_admin_live_confirmed_provider(text,text,text) from public,anon,authenticated,service_role;

do $patch_0$
declare target regprocedure:='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$private.dashboard_admin_live_confirmed_usdt_provider(r.country,r.raw_provider)$old$;
 new_fragment text:=$new$private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider)$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>2 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_0$;
do $patch_1$
declare target regprocedure:='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$private.dashboard_admin_live_confirmed_usdt_provider(r.country,r.raw_provider)$old$;
 new_fragment text:=$new$private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider)$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_1$;
do $patch_2$
declare target regprocedure:='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$private.dashboard_admin_live_confirmed_usdt_provider(r.country,r.raw_provider)$old$;
 new_fragment text:=$new$private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider)$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_2$;
do $patch_3$
declare target regprocedure:='private.dashboard_admin_live_provider_rows()'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$private.dashboard_admin_live_confirmed_usdt_provider(stored.country,stored.raw_provider)$old$;
 new_fragment text:=$new$private.dashboard_admin_live_confirmed_provider(stored.country,stored.platform,stored.raw_provider)$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>2 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_3$;
do $patch_4$
declare target regprocedure:='private.dashboard_admin_live_workorder_provider_batch(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$private.dashboard_admin_live_confirmed_usdt_provider(r.country,registry_raw)$old$;
 new_fragment text:=$new$private.dashboard_admin_live_confirmed_provider(r.country,r.platform,registry_raw)$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_4$;
do $patch_5$
declare target regprocedure:='private.dashboard_admin_wg_order_source(text,boolean)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$coalesce(nullif(btrim(w.provider),''),'未识别通道') as provider$old$;
 new_fragment text:=$new$case when w.business='recharge' and w.channel='提现转充值'
    and not exists(select 1 from private.dashboard_admin_provider_overrides manual
      join private.dashboard_admin_wg_sites() site on site.site_code=w.site_code
      where manual.country=site.country and manual.platform=site.platform
        and manual.raw_provider=coalesce(btrim(w.provider),'') and manual.canonical_provider is not null)
   then '提现转充值' else coalesce(nullif(btrim(w.provider),''),'未识别通道') end as provider$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_5$;
do $patch_6$
declare target regprocedure:='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$    select provider from matches union$old$;
 new_fragment text:=$new$    -- User-confirmed WG business category; offering a filter does not invent a count.
    select '提现转充值'::text as provider from platforms p
    where p.source='wg' and coalesce(p_request->>'direction','all') in ('all','charge')
    union
    select provider from matches union$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_6$;
do $patch_7$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',count(v.effective_from) filter(where f.amount>=0),
      'fee_version_unmatched_count',count(*)-count(v.effective_from) filter(where f.amount>=0),
      'fee_version_estimated_amount',(sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0))::text,
      'fee_version_state',case when count(v.effective_from) filter(where f.amount>=0)=count(*) then 'complete'
        when count(v.effective_from) filter(where f.amount>=0)>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
    group by f.direction,f.currency,f.provider
$old$;
 new_fragment text:=$new$  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>2 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_7$;
do $patch_8$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range$old$;
 new_fragment text:=$new$select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>2 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_8$;
do $patch_9$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$v_max_exclusive,v_fee_country,v_fee_currency_proven;$old$;
 new_fragment text:=$new$v_max_exclusive,v_fee_country,v_fee_currency_proven,(v_platform.source='wg');$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_9$;
do $patch_10$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$x||private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type'))$old$;
 new_fragment text:=$new$x||case when v_platform.source='wg' and x->>'direction'='charge' and x->>'channel_type'='提现转充值' then
      jsonb_build_object('fee_exempt',true,'fee_exempt_reason','wg_withdraw_to_charge','fee_version_state','complete',
        'fee_version_ids','[]'::jsonb,'fee_version_percent_rate','0','fee_version_fixed_fee','0',
        'fee_version_estimated_amount','0','fee_version_basis','native_business_rule')
      else private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) end$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'vn_provider_patch_anchor_drift: %',target;end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata then raise exception 'vn_provider_metadata_changed: %',target;end if;
end;
$patch_10$;
do $exempt_merge$
declare target regprocedure:='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure;metadata jsonb;definition text;
begin
 select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) into metadata,definition from pg_proc p where p.oid=target;
 if position($old$'fee_version_matched_count','fee_version_unmatched_count'];$old$ in definition)=0 then raise exception 'vn_exempt_merge_anchor_drift';end if;
 execute replace(definition,$old$'fee_version_matched_count','fee_version_unmatched_count'];$old$,$new$'fee_version_matched_count','fee_version_unmatched_count','fee_exempt_count'];$new$);
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from metadata then raise exception 'vn_exempt_merge_metadata_changed';end if;
end;
$exempt_merge$;
commit;
