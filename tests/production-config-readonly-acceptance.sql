-- Bounded post-deploy verification, explicitly authorized by task owner.
-- READ ONLY; existing active owner selected inside the database; identity/token
-- never returned. Rollback clears the transaction-local claims and role.
begin read only;
set local statement_timeout='25s';
do $$ declare v_user uuid; begin
  select auth_user_id into v_user from public.dashboard_profiles where active is true and role='owner' order by auth_user_id limit 1;
  if v_user is null then raise exception 'no_existing_active_owner'; end if;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
end $$;
set local role authenticated;
with meta as materialized (select public.dashboard_admin_live_rate_sheet('{}') as v)
select 'original_rate_sheet' as check_name,v is not null as available,jsonb_array_length(v->'sheets') as sheet_count from meta;
with systems(system) as (values('AR'),('NEW_AR'),('PANDA'),('WG'),('GAME66_HK'),('GAME66_RED_CRAB')),
indexes as materialized(select system,public.dashboard_admin_live_payout_config(jsonb_build_object('operation','index','system',system)) v from systems),
picked as(select system,v,(select t from jsonb_array_elements(v->'targets') t where exists(select 1 from jsonb_array_elements(v->'summaries') s where s->>'country_code'=t->>'country_code' and s->>'platform'=t->>'platform') limit 1) t from indexes),
snapshots as materialized(select system,v,case when t is not null then public.dashboard_admin_live_payout_config(jsonb_build_object('operation','snapshot','system',system,'country',t->>'country_code','platform',t->>'platform')) end s from picked)
select (select jsonb_array_length(public.dashboard_admin_live_rate_sheet('{}')->'sheets')) original_rate_sheet_count,
 system,jsonb_array_length(v->'targets') target_count,jsonb_array_length(v->'summaries') sampled_target_count,
 (s->'snapshot' is not null and s->'snapshot'<>'null'::jsonb) snapshot_available,
 s#>>'{snapshot,observed_local_date}' observed_day,
 (select count(*) from jsonb_object_keys(coalesce(s#>'{snapshot,configuration}','{}'))) config_section_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,fields}')='array' then jsonb_array_length(s#>'{snapshot,configuration,fields}') end field_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,values}')='object' then (select count(*) from jsonb_object_keys(s#>'{snapshot,configuration,values}')) end value_field_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,settings}')='object' then (select count(*) from jsonb_object_keys(s#>'{snapshot,configuration,settings}')) end brand_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,rules}')='array' then jsonb_array_length(s#>'{snapshot,configuration,rules}') end rule_count
from snapshots order by system;
rollback;
