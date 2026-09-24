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
select system,jsonb_array_length(v->'targets') target_count,jsonb_array_length(v->'summaries') sampled_target_count,
 (s->'snapshot' is not null and s->'snapshot'<>'null'::jsonb) snapshot_available,
 s#>>'{snapshot,observed_local_date}' observed_day,
 (select count(*) from jsonb_object_keys(coalesce(s#>'{snapshot,configuration}','{}'))) config_section_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,fields}')='array' then jsonb_array_length(s#>'{snapshot,configuration,fields}') end field_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,values}')='object' then (select count(*) from jsonb_object_keys(s#>'{snapshot,configuration,values}')) end value_field_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,settings}')='object' then (select count(*) from jsonb_object_keys(s#>'{snapshot,configuration,settings}')) end brand_count,
 case when jsonb_typeof(s#>'{snapshot,configuration,rules}')='array' then jsonb_array_length(s#>'{snapshot,configuration,rules}') end rule_count
from snapshots order by system;
with catalog as materialized(select public.dashboard_admin_live_query('{"action":"catalog"}') as v),
picked as(select p from catalog,jsonb_array_elements(v->'platforms') p where p->>'source'='game66' order by p->>'id' limit 1),
result as materialized(select public.dashboard_admin_live_query(jsonb_build_object('action','aggregate','platformId',p->>'id','startAt','2026-09-22T00:00:00+05:30','endAt','2026-09-22T06:00:00+05:30','direction','all','status','all')) v from picked),
counts as(select kind,g->>'direction' direction,g->>'currency' currency,sum((g->>'all_count')::bigint) n,sum((g->>'all_amount')::numeric) amount from result cross join lateral(values('summary',v->'summary'),('amount',v#>'{groups,amount}'),('matrix',v#>'{groups,matrix}'),('amount_range',v#>'{groups,amount_range}'),('matrix_range',v#>'{groups,matrix_range}')) x(kind,groups) cross join lateral jsonb_array_elements(groups) g group by kind,g->>'direction',g->>'currency')
select c.direction,c.currency,max(c.n) order_count,count(*) checked_group_sets,bool_and(c.n=s.n) count_conserved,bool_and(c.amount is not distinct from s.amount) amount_conserved
from counts c join counts s on s.kind='summary' and s.direction=c.direction and s.currency is not distinct from c.currency group by c.direction,c.currency;
rollback;
