-- Read-only automatic withdrawal statistics across selected authorized source teams.
-- Patch the current function in place, preserving source adapters, ACL and wrappers.
begin;
do $patch$
declare definition text; original text; replacement text; expected integer;
begin
 select pg_get_functiondef('private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure) into definition;
 if position('scope_targets_v1' in definition)>0 then return;end if;
 original:=$old0$v_limit integer;v_offset integer;v_result jsonb;v_game jsonb:='{}'::jsonb;v_daily boolean;$old0$;
 replacement:=$new0$v_limit integer;v_offset integer;v_result jsonb;v_game jsonb:='{}'::jsonb;v_daily boolean;
 v_targets jsonb;v_target jsonb;v_game_part jsonb;v_target_platforms text[];$new0$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 0; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old1$'ascending','daily','offset','limit']<>'{}'::jsonb$old1$;
 replacement:=$new1$'ascending','daily','offset','limit','scopeTargets']<>'{}'::jsonb$new1$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 1; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old2$ if exists(select 1 from public.game66_platforms where team_name=v_country) then
  v_game:=private.dashboard_admin_live_game66_withdraw(v_before,v_end,v_country,v_platforms);
 end if;$old2$;
 replacement:=$new2$ -- scope_targets_v1: preserve source country and exact platforms across teams.
 if p_request ? 'scopeTargets' then
  if jsonb_typeof(p_request->'scopeTargets') is distinct from 'array' or jsonb_array_length(p_request->'scopeTargets') not between 1 and 8 then
   raise exception using errcode='22023',message='invalid_scope_targets';end if;
  for v_target in select value from jsonb_array_elements(p_request->'scopeTargets') loop
   if jsonb_typeof(v_target) is distinct from 'object' or v_target-array['country','platforms']<>'{}'::jsonb
    or jsonb_typeof(v_target->'country') is distinct from 'string' or length(btrim(v_target->>'country')) not between 1 and 200
    or v_target->>'country'<>btrim(v_target->>'country') or v_target->>'country' ~ '[[:cntrl:]]'
    or (case v_target->>'country' when '胖虎巴西' then '巴西' when '香港' then '印度' when '红膏蟹' then '印度' when 'LG' then '菲律宾' else v_target->>'country' end)<>v_country
    or jsonb_typeof(v_target->'platforms') is distinct from 'array' or jsonb_array_length(v_target->'platforms') not between 1 and 200 then
    raise exception using errcode='22023',message='invalid_scope_targets';end if;
   if exists(select 1 from jsonb_array_elements(v_target->'platforms')p where jsonb_typeof(p)<>'string' or length(btrim(p#>>'{}')) not between 1 and 200 or p#>>'{}'<>btrim(p#>>'{}') or p#>>'{}' ~ '[[:cntrl:]]') then
    raise exception using errcode='22023',message='invalid_scope_targets';end if;
  end loop;
  if (select count(distinct value->>'country') from jsonb_array_elements(p_request->'scopeTargets'))<>jsonb_array_length(p_request->'scopeTargets') then
   raise exception using errcode='22023',message='invalid_scope_targets';end if;
  v_targets:=p_request->'scopeTargets';
 else
  v_targets:=jsonb_build_array(jsonb_build_object('country',v_country,'platforms',null));
 end if;
 for v_target in select value from jsonb_array_elements(v_targets) loop
  if exists(select 1 from public.game66_platforms where team_name=v_target->>'country') then
   select case when p_request ? 'scopeTargets' then array(select private.dashboard_admin_live_withdraw_key(value) from jsonb_array_elements_text(v_target->'platforms')) else v_platforms end into v_target_platforms;
   v_game_part:=private.dashboard_admin_live_game66_withdraw(v_before,v_end,v_target->>'country',v_target_platforms);
   v_game:=jsonb_build_object('rows',coalesce(v_game->'rows','[]'::jsonb)||coalesce(v_game_part->'rows','[]'::jsonb),
     'operatorRows',coalesce(v_game->'operatorRows','[]'::jsonb)||coalesce(v_game_part->'operatorRows','[]'::jsonb));
  end if;
 end loop;$new2$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 2; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old3$ with direct as materialized (
  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key from public.newar_business_snapshots s
  where s.kind='auto_withdraw_bundle' and s.direction='all'
   and $old3$;
 replacement:=$new3$ with selected_targets as materialized (
  select value->>'country' as country,case when jsonb_typeof(value->'platforms')='array'
    then array(select private.dashboard_admin_live_withdraw_key(p) from jsonb_array_elements_text(value->'platforms')p) end as platforms
  from jsonb_array_elements(v_targets)
 ), direct as materialized (
  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key,t.country as target_country from public.newar_business_snapshots s
  join selected_targets t on $new3$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 3; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old4$end)=v_country
   and s.stat_date$old4$;
 replacement:=$new4$end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(s.platform)=any(t.platforms))
  where s.kind='auto_withdraw_bundle' and s.direction='all' and s.stat_date$new4$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 4; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old5$private.dashboard_scope_allows(v_scope,v_country,s.platform)$old5$;
 replacement:=$new5$private.dashboard_scope_allows(v_scope,t.country,s.platform)$new5$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 5; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old6$distinct on(a.data_date,private.dashboard_admin_live_withdraw_key(a.platform)$old6$;
 replacement:=$new6$distinct on(a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform)$new6$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 6; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old7$a.data_date,v_country as country$old7$;
 replacement:=$new7$a.data_date,t.country as country$new7$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 7; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old8$from public.auto_withdraw_daily a where (case$old8$;
 replacement:=$new8$from public.auto_withdraw_daily a join selected_targets t on (case$new8$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 8; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old9$end)=v_country and a.data_date$old9$;
 replacement:=$new9$end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(a.platform)=any(t.platforms)) where a.data_date$new9$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 9; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old10$private.dashboard_scope_allows(v_scope,v_country,a.platform)$old10$;
 replacement:=$new10$private.dashboard_scope_allows(v_scope,t.country,a.platform)$new10$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 10; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old11$where n.stat_date=a.data_date and n.platform_key$old11$;
 replacement:=$new11$where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key$new11$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 11; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old12$order by a.data_date,private.dashboard_admin_live_withdraw_key(a.platform)$old12$;
 replacement:=$new12$order by a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform)$new12$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 12; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old13$distinct on(o.data_date,private.dashboard_admin_live_withdraw_key(o.platform)$old13$;
 replacement:=$new13$distinct on(o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform)$new13$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 13; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old14$o.data_date,v_country as country$old14$;
 replacement:=$new14$o.data_date,t.country as country$new14$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 14; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old15$from public.withdraw_operator_daily o where (case$old15$;
 replacement:=$new15$from public.withdraw_operator_daily o join selected_targets t on (case$new15$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 15; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old16$end)=v_country and o.data_date$old16$;
 replacement:=$new16$end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(o.platform)=any(t.platforms)) where o.data_date$new16$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 16; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old17$private.dashboard_scope_allows(v_scope,v_country,o.platform)$old17$;
 replacement:=$new17$private.dashboard_scope_allows(v_scope,t.country,o.platform)$new17$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 17; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old18$where n.stat_date=o.data_date and n.platform_key$old18$;
 replacement:=$new18$where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key$new18$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 18; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old19$order by o.data_date,private.dashboard_admin_live_withdraw_key(o.platform)$old19$;
 replacement:=$new19$order by o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform)$new19$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 19; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old20$select n.stat_date,v_country,n.platform$old20$;
 replacement:=$new20$select n.stat_date,n.target_country,n.platform$new20$;
 expected:=2;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 20; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old21$from public.auto_withdraw_notes n where (case$old21$;
 replacement:=$new21$from public.auto_withdraw_notes n join selected_targets t on (case$new21$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 21; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old22$end)=v_country and n.data_date$old22$;
 replacement:=$new22$end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(t.platforms)) where n.data_date$new22$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 22; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old23$count(distinct platform_key)$old23$;
 replacement:=$new23$count(distinct(country,platform_key))$new23$;
 expected:=4;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 23; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old24$count(distinct (platform_key,account))$old24$;
 replacement:=$new24$count(distinct (country,platform_key,account))$new24$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 24; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old25$count(distinct(platform_key,account))$old25$;
 replacement:=$new25$count(distinct(country,platform_key,account))$new25$;
 expected:=2;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 25; review before applying';end if;
 definition:=replace(definition,original,replacement);
 original:=$old26$'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text))) from public.auto_withdraw_notes$old26$;
 replacement:=$new26$'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from public.auto_withdraw_notes$new26$;
 expected:=1;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>expected then
  raise exception 'Auto-withdraw scope baseline changed at anchor 26; review before applying';end if;
 definition:=replace(definition,original,replacement);
 execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
