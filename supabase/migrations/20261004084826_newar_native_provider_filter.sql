-- Expand canonical NEWAR provider selections against native names in the
-- authorized query window. Preserve order engine, fee math and all other sources.
begin;
select set_config('lock_timeout','3s',true);
select set_config('statement_timeout','30s',true);
do $patch$
declare old_def text; old_meta jsonb; patched text;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into old_def,old_meta from pg_proc p
 where p.oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure;
 if old_meta->>'prosecdef'<>'true' or old_meta->>'provolatile'<>'s'
   or old_meta->'proconfig'<>to_jsonb(array['search_path=""']::text[])
   or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure and a.grantee not in (p.proowner,(select oid from pg_roles where rolname='authenticated')))
   then raise exception 'NEWAR_PROVIDER_FILTER_METADATA_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure)='e5aa9256fab98bf6f67b62b1fa75faf6' then return;end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure)<>'42cc6fc75303a7a77dab967b80074902'
   then raise exception 'NEWAR_PROVIDER_FILTER_BASELINE_CHANGED';end if;
 if length(old_def)-length(replace(old_def,$needle$  if v_platform.source='lg' then$needle$,''))<>length($needle$  if v_platform.source='lg' then$needle$)
   then raise exception 'NEWAR_PROVIDER_FILTER_PATCH_LOCATION_CHANGED';end if;
 patched:=replace(old_def,$needle$  if v_platform.source='lg' then$needle$,$branch$  if v_platform.source='newar' then
    declare
      native_start timestamptz; native_end timestamptz;
      native_direction text:=coalesce(p_request->>'direction','all');
      native_success boolean:=coalesce(p_request->>'action','catalog')='aggregate' or coalesce(p_request->>'status','all')='success';
    begin
      -- The original reader still validates the request. Never enumerate native
      -- orders for malformed/unbounded input before it reaches that validator.
      if native_direction not in ('all','charge','withdraw')
        or coalesce(jsonb_typeof(p_request->'startAt'),'null')<>'string'
        or coalesce(jsonb_typeof(p_request->'endAt'),'null')<>'string' then return p_request; end if;
      begin
        native_start:=(p_request->>'startAt')::timestamptz;
        native_end:=(p_request->>'endAt')::timestamptz;
      exception when others then return p_request; end;
      if native_start is null or native_end is null or not isfinite(native_start) or not isfinite(native_end)
        or native_end<=native_start or native_end-native_start>interval '32 days' then return p_request; end if;
      with native_rows as materialized (
        -- Separate creation/success branches use the existing time indexes.
        -- Both are required for historical orders that succeeded on this day.
        select n.provider,n.dataset,n.channel_type,n.status_group
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=v_platform.source_name and n.dataset=any(case native_direction when 'all' then array['charge','withdraw'] else array[native_direction] end)
          and n.created_at>=native_start and n.created_at<native_end
          and (t.launch_at is null or n.created_at>=t.launch_at)
        union all
        select n.provider,n.dataset,n.channel_type,n.status_group
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where native_success and n.platform=v_platform.source_name
          and n.dataset=any(case native_direction when 'all' then array['charge','withdraw'] else array[native_direction] end)
          and n.status_group='success' and n.success_at is not null and n.success_at>=native_start and n.success_at<native_end
          and (t.launch_at is null or n.created_at>=t.launch_at)
      ), native_names as materialized (
        -- Exactly the same native labels as the existing order engine.
        select distinct case when dataset='charge' and coalesce(btrim(provider),'')='' and channel_type='ManualRecharge' then '人工充值'
          when dataset='withdraw' and status_group in ('failed','rejected') and coalesce(btrim(provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(provider),''),'未识别通道') end provider from native_rows
      ), matches as (
        select unnest(v_selected) provider
        union select n.provider from native_names n
          where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
      ) select array_agg(distinct provider order by provider) into v_raw from matches;
      return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
    end;
  end if;
  if v_platform.source='lg' then$branch$);
 execute patched;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure) is distinct from old_meta
   or (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure)<>'e5aa9256fab98bf6f67b62b1fa75faf6'
   then raise exception 'NEWAR_PROVIDER_FILTER_PATCH_MISMATCH';end if;
end;$patch$;
notify pgrst,'reload schema';
commit;
