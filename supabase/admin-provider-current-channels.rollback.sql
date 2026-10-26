-- Restore the exact previous provider directory function.
-- No raw-order scan, registry write, new alias, permission or financial change.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $install$
declare
 target regprocedure:='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;
 old_row pg_proc%rowtype; new_row pg_proc%rowtype;
 old_definition text; new_definition text; anchor text;
begin
 select * into strict old_row from pg_proc where oid=target;
 if md5(old_row.prosrc) is distinct from 'b08d4c52c1c4b1181fe1c957598fb032'
   or old_row.proowner::regrole::text<>'postgres'
   or old_row.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
   or old_row.proconfig is distinct from array['search_path=""']
   or not old_row.prosecdef or old_row.provolatile<>'s' or old_row.proparallel<>'u'
 then raise exception 'provider_options_current_channels_baseline_drift'; end if;
 old_definition:=pg_get_functiondef(target);
 foreach anchor in array array[$anchor1$  ), ar_channel_names as materialized (
    select distinct p.country,p.source_name,
      nullif(btrim(c.channel_data->>'channel_name'),'') as raw_provider
    from platforms p
    join private.ar_middle_channel_platforms b
      on b.dashboard_platform_id=p.id and b.enabled
      and b.country_code=p.scope_group and b.native_platform=p.source_name
    join private.ar_middle_channels c
      on c.source_origin=b.source_origin and c.source_tenant_id=b.source_tenant_id
      and c.is_present
    join private.ar_middle_channel_sync_state s
      on s.source_origin=c.source_origin and s.source_tenant_id=c.source_tenant_id
      and s.order_type=c.order_type and s.snapshot_id=c.snapshot_id
      and s.observed_at=c.observed_at
    where p.source='ar'
      and c.order_type=any(case coalesce(p_request->>'direction','all')
        when 'all' then array['deposit','withdrawal']
        when 'charge' then array['deposit'] else array['withdrawal'] end)
      and nullif(btrim(c.channel_data->>'channel_name'),'') is not null
  ), lg_names as materialized ($anchor1$,$anchor2$    select provider from matches union
    select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider)
    from ar_channel_names
    union
$anchor2$] loop
  if length(old_definition)-length(replace(old_definition,anchor,''))<>length(anchor)
  then raise exception 'provider_options_current_channels_anchor_drift'; end if;
 end loop;
 new_definition:=replace(old_definition,$old1$  ), ar_channel_names as materialized (
    select distinct p.country,p.source_name,
      nullif(btrim(c.channel_data->>'channel_name'),'') as raw_provider
    from platforms p
    join private.ar_middle_channel_platforms b
      on b.dashboard_platform_id=p.id and b.enabled
      and b.country_code=p.scope_group and b.native_platform=p.source_name
    join private.ar_middle_channels c
      on c.source_origin=b.source_origin and c.source_tenant_id=b.source_tenant_id
      and c.is_present
    join private.ar_middle_channel_sync_state s
      on s.source_origin=c.source_origin and s.source_tenant_id=c.source_tenant_id
      and s.order_type=c.order_type and s.snapshot_id=c.snapshot_id
      and s.observed_at=c.observed_at
    where p.source='ar'
      and c.order_type=any(case coalesce(p_request->>'direction','all')
        when 'all' then array['deposit','withdrawal']
        when 'charge' then array['deposit'] else array['withdrawal'] end)
      and nullif(btrim(c.channel_data->>'channel_name'),'') is not null
  ), lg_names as materialized ($old1$,$new1$  ), lg_names as materialized ($new1$);
 new_definition:=replace(new_definition,$old2$    select provider from matches union
    select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider)
    from ar_channel_names
    union
$old2$,$new2$    select provider from matches union
$new2$);
 if new_definition=old_definition then raise exception 'provider_options_current_channels_missing_anchor'; end if;
 execute new_definition;
 select * into strict new_row from pg_proc where oid=target;
 if (to_jsonb(new_row)-'prosrc') is distinct from (to_jsonb(old_row)-'prosrc')
 then raise exception 'provider_options_current_channels_metadata_drift'; end if;
 if md5(new_row.prosrc) is distinct from '8bc1df84f40062be7de68b87cda42b0a'
 then raise exception 'provider_options_current_channels_missing_body'; end if;
end;
$install$;
commit;
