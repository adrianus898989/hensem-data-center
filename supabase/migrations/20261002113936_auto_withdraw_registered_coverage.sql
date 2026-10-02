-- Exact registered GAME66 coverage for the same authorized selected scope.
-- Read-only metadata; missing daily facts stay unknown and never enter money/count totals.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare target regprocedure:='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text;
 old_catalog text:=$old$ ), direct as materialized ($old$;
 new_catalog text:=$new$ ), registered_game66 as materialized (
  select distinct g.team_name as country,g.platform_name as platform,
    private.dashboard_admin_live_withdraw_key(g.platform_name) as platform_key
  from public.game66_platforms g join selected_targets t on g.team_name=t.country
    and (t.platforms is null or private.dashboard_admin_live_withdraw_key(g.platform_name)=any(t.platforms))
  where (v_platforms is null or private.dashboard_admin_live_withdraw_key(g.platform_name)=any(v_platforms))
    and private.dashboard_scope_allows(v_scope,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
      g.platform_name)
 ), direct as materialized ($new$;
 old_output text:=$old$  'canWriteNotes',private.dashboard_admin_live_can_note(),$old$;
 new_output text:=$new$  'platformCoverage',(
   select jsonb_build_object('basis','registered_game66_selected_scope',
    'expectedCount',count(*),'recordedCount',count(*) filter(where covered_days>0),
    'missingCount',count(*) filter(where covered_days=0),
    'platforms',coalesce(jsonb_agg(jsonb_build_object('country',country,'platform',platform,'source','game66',
      'state',case when covered_days>0 then 'recorded' else 'no_selected_period_record' end,
      'coveredDays',covered_days,'expectedDays',v_days) order by country,platform),'[]'::jsonb))
   from (
    select g.*,coalesce((select sum(d.covered_days)::integer from daily_group d
      where d.current_period and d.country=g.country and d.platform_key=g.platform_key),0) as covered_days
    from registered_game66 g
   ) observed
  ),
  'canWriteNotes',private.dashboard_admin_live_can_note(),$new$;
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc) is distinct from 'a30aa0ce34f1a2e2f643514f82645ffc'
  then raise exception 'auto_withdraw_coverage_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
  then raise exception 'auto_withdraw_coverage_metadata_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_catalog,'')))/length(old_catalog)<>1
  or (length(definition)-length(replace(definition,old_output,'')))/length(old_output)<>1
  then raise exception 'auto_withdraw_coverage_patch_anchor_drift';end if;
 execute replace(replace(definition,old_catalog,new_catalog),old_output,new_output);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata
  then raise exception 'auto_withdraw_coverage_metadata_changed';end if;
end;
$patch$;
commit;
