-- Read-only collection diagnostics. Unknown currency and late observations stay
-- outside the existing midnight proof; archive/order/collector data is untouched.
begin;
set local lock_timeout='3s'; set local statement_timeout='15s';
do $preflight$
declare p pg_proc%rowtype; h record;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure;
 if p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or not ((md5(p.prosrc)='38f374dd5781210f672329762ef5e2b7' and md5(pg_get_functiondef(p.oid))='407773fa6b61629867bef3c1a0d5787a')
    or (md5(p.prosrc)='47e479ae7f88e4fcdeddf0a9c12a58c9' and md5(pg_get_functiondef(p.oid))='72a6d80d0e56fbe23d440d971bc807e4')) then
  raise exception 'pending_diagnostics_baseline_drift'; end if;
 for h in select * from(values
  ('private.dashboard_admin_pending_collection_diagnostics(jsonb,jsonb,date,date,text[])','34f15e9357221a542d59fd0952617e9e','ebe1881d874886bb856e94197afad593'),
  ('private.dashboard_admin_pending_collection_day(jsonb,jsonb)','3227da4ae537ae0d6a0c86ec0af59f0c','7aecd8a5c8bc8eab5ef3e453b8b31ab8')
 ) v(signature,body_hash,definition_hash) loop
  if md5(p.prosrc)='38f374dd5781210f672329762ef5e2b7' and to_regprocedure(h.signature) is not null then
   raise exception 'pending_diagnostics_helper_exists'; end if;
  if md5(p.prosrc)='47e479ae7f88e4fcdeddf0a9c12a58c9' then
   if not exists(select 1 from pg_proc x where x.oid=to_regprocedure(h.signature)
    and md5(x.prosrc)=h.body_hash and md5(pg_get_functiondef(x.oid))=h.definition_hash and x.proowner='postgres'::regrole and not x.prosecdef and x.provolatile='s'
    and x.proconfig=array['search_path=""'] and x.proacl::text='{postgres=X/postgres}') then
    raise exception 'pending_diagnostics_helper_drift'; end if;
  end if;
 end loop;
end $preflight$;

-- Read each exact authorized physical platform once across the bounded period.
-- No amount field or payment-channel label establishes a currency here.
create or replace function private.dashboard_admin_pending_collection_diagnostics(
 p_catalog jsonb,p_scope jsonb,p_start date,p_end date,p_providers text[])
returns jsonb language sql stable security invoker set search_path='' as $diagnostics$
 with targets as materialized(
  select x from jsonb_array_elements(p_catalog)x
  where x->>'source' in('ar','newar','withdraw')
   and private.dashboard_scope_allows(p_scope,x->>'scope_group',x->>'source_name')
 ), captures as materialized(
  select t.x,a.id,a.platform,a.stat_date,a.snapshot_at,a.snapshot,a.timezone,a.pending_count,a.pending_amount,
   private.dashboard_admin_pending_archive_currency(a.id) currency,
   row_number()over(partition by t.x->>'id',a.stat_date
    order by case when a.within_midnight_window then 0 else 1 end,
     case when a.within_midnight_window then a.snapshot_at end asc,
     case when not a.within_midnight_window then a.snapshot_at end desc,a.id) pick
  from targets t join private.withdraw_pending_capture_archive a
   on a.source_system='WITHDRAW_REVIEW' and a.country_code=t.x->>'scope_group'
    and a.platform=t.x->>'source_name' and a.stat_date between p_start and p_end
  where private.dashboard_scope_allows(p_scope,a.country_code,a.platform)
   and a.identity_status='resolved' and a.platform_id::text=t.x->>'id'
   and a.native_source_system=case t.x->>'source' when 'ar' then 'AR' when 'newar' then 'NEW_AR' end
   and a.team_name is not distinct from t.x->>'team' and a.timezone is not distinct from t.x->>'timezone'
 ), filtered as(
  select a.*,case when coalesce(cardinality(p_providers),0)=0 then a.pending_count else f.n end selected_count,
   case when coalesce(cardinality(p_providers),0)=0 then a.pending_amount else f.amount end selected_amount
  from captures a left join lateral(
   select coalesce(sum((g->>'pending_count')::bigint),0)::bigint n,
    coalesce(sum((g->>'pending_amount')::numeric),0) amount
   from jsonb_array_elements(a.snapshot->'groups')g
   where cardinality(p_providers)>0 and private.dashboard_admin_live_provider_canonical(a.x->>'country',a.platform,g->>'raw_channel')=any(p_providers)
  )f on true where a.pick=1
 ), launches as(
  select t.x->>'id' id,min((n.launch_at at time zone n.timezone)::date) launch_date
  from targets t join public.newar_detail_platforms n
   on n.enabled and n.country_code=t.x->>'scope_group' and n.platform=t.x->>'source_name'
    and n.timezone=t.x->>'timezone' and n.launch_at is not null
  where private.dashboard_scope_allows(p_scope,n.country_code,n.platform)
   and (t.x->>'source'='newar' or exists(select 1 from public.ar_config_targets c
    where c.country_code=n.country_code and c.platform=n.platform and c.source_system='NEW_AR'
     and private.dashboard_scope_allows(p_scope,c.country_code,c.platform)))
   and exists(select 1 from public.dashboard_platform_team_map m where m.active and m.source_system='NEW_AR'
    and m.country_code=n.country_code and m.source_platform=n.platform and m.team_name=t.x->>'team'
    and private.dashboard_scope_allows(p_scope,m.country_code,m.source_platform))
  group by t.x->>'id'
 )select jsonb_build_object(
  'captures',(select coalesce(jsonb_object_agg(jsonb_build_array(a.x->>'id',a.stat_date::text)::text,
   jsonb_build_object('observedAt',a.snapshot_at,'currency',a.currency,
    'amount',a.selected_amount::text,'count',a.selected_count,
    'targetAt',(a.stat_date+1)::timestamp at time zone a.timezone,
    'timingState',case when a.snapshot_at<(a.stat_date+1)::timestamp at time zone a.timezone then 'unknown'
     when a.snapshot_at<=((a.stat_date+1)::timestamp at time zone a.timezone)+interval '5 minutes' then 'on_time' else 'late' end)), '{}')from filtered a),
  'launchDates',(select coalesce(jsonb_object_agg(id,launch_date::text),'{}')from launches));
$diagnostics$;

-- Pure projection. Diagnostic stock cannot promote a missing row to complete,
-- replace the original amount/count, or repair missing midnight/currency proof.
create or replace function private.dashboard_admin_pending_collection_day(p_day jsonb,p_diagnostics jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $day$
declare r jsonb; d jsonb; rows jsonb:='[]'; reasons jsonb; launch_date date;
 expected integer:=0; received integer:=0; not_launched integer:=0; n bigint; amount numeric; g jsonb;
begin
 for r in select value from jsonb_array_elements(p_day->'rows')loop
  launch_date:=(p_diagnostics#>>array['launchDates',r->>'id'])::date;
  if launch_date is not null and (p_day->>'snapshotDate')::date<launch_date then
   r:=r||jsonb_build_object('state','not_launched','expectedForDate',false,'launchDate',launch_date,
    'amount',null,'count',null,'groups','[]'::jsonb,'midnightEligible',false,
    'diagnosticArchiveVerified',false,'diagnosticReasons','[]'::jsonb);
   not_launched:=not_launched+1;
  else
   expected:=expected+1; r:=r||jsonb_build_object('expectedForDate',true);
   d:=p_diagnostics#>array['captures',jsonb_build_array(r->>'id',p_day->>'snapshotDate')::text];
   if d is not null then
    reasons:='[]';
    if d->>'currency' is null then reasons:=reasons||'"currency_unverified"'::jsonb;
    elsif d->>'currency' is distinct from r->>'currency' then reasons:=reasons||'"currency_mismatch"'::jsonb;end if;
    if d->>'timingState'<>'on_time' then reasons:=reasons||'"outside_midnight_window"'::jsonb;end if;
    r:=r||jsonb_build_object('diagnosticArchiveVerified',true,'diagnosticReasons',reasons,
     'diagnosticObservedAt',d->'observedAt','diagnosticObservedAmount',d->'amount','diagnosticObservedCount',d->'count',
     'diagnosticCurrency',d->'currency','diagnosticTimingState',d->'timingState','diagnosticTargetAt',d->'targetAt');
   elsif r->>'source'in('ar','newar','withdraw')then
    r:=r||jsonb_build_object('diagnosticArchiveVerified',false,'diagnosticReasons',jsonb_build_array('capture_missing'));
   end if;
   if r->>'state'='complete' then received:=received+1;end if;
  end if;
  rows:=rows||jsonb_build_array(r);
 end loop;
 -- Normally these sums equal the original reader. Excluding a pre-launch row
 -- also excludes all its values rather than subtracting guessed zeros.
 select sum((x->>'count')::bigint)::bigint,sum((x->>'amount')::numeric)into n,amount
 from jsonb_array_elements(rows)x where x->>'state'='complete';
 select coalesce(jsonb_agg(jsonb_build_object('provider',q.provider,'count',q.n,'amount',q.amount::text)order by q.n desc,q.provider),'[]')into g
 from(select z->>'provider' provider,sum((z->>'count')::bigint)::bigint n,sum((z->>'amount')::numeric)amount
  from jsonb_array_elements(rows)x cross join lateral jsonb_array_elements(x->'groups')z where x->>'state'='complete'group by 1)q;
 return p_day||jsonb_build_object('rows',rows,'selectedPlatformCount',jsonb_array_length(rows),
  'notLaunchedPlatformCount',not_launched,'expectedPlatformCount',expected,'receivedPlatformCount',received,
  'complete',expected>0 and received=expected,'amount',amount::text,'count',n,'groups',g,
  'summary',jsonb_build_object('amount',amount::text,'count',n),
  'missingPlatforms',(select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','name',x->>'name','state',x->>'state')),'[]')
   from jsonb_array_elements(rows)x where x->>'expectedForDate'='true'and x->>'state'<>'complete'));
end;
$day$;
revoke all on function private.dashboard_admin_pending_collection_diagnostics(jsonb,jsonb,date,date,text[]),
 private.dashboard_admin_pending_collection_day(jsonb,jsonb)from public,anon,authenticated,service_role;

do $patch$
declare target regprocedure:='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure;
 old_metadata jsonb; definition text; current_body text;
begin
 select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid),md5(p.prosrc)into old_metadata,definition,current_body from pg_proc p where p.oid=target;
 if current_body='38f374dd5781210f672329762ef5e2b7' then
  if (length(definition)-length(replace(definition,'v_provider_map jsonb;v_timezones text[];','')))/length('v_provider_map jsonb;v_timezones text[];')<>1
   or (length(definition)-length(replace(definition,' v_backlogs:=private.dashboard_admin_pending_capture_heads','')))/length(' v_backlogs:=private.dashboard_admin_pending_capture_heads')<>1
   or (length(definition)-length(replace(definition,'  v_day:=private.dashboard_admin_pending_capture_day(v_day,v_catalog,v_day_backlogs);','')))/length('  v_day:=private.dashboard_admin_pending_capture_day(v_day,v_catalog,v_day_backlogs);')<>1
   or (length(definition)-length(replace(definition,$old$ for v_row in select value from jsonb_array_elements(v_day->'rows') loop$old$,'')))/length($old$ for v_row in select value from jsonb_array_elements(v_day->'rows') loop$old$)<>1 then
   raise exception 'pending_diagnostics_patch_shape_drift';end if;
  definition:=replace(definition,'v_provider_map jsonb;v_timezones text[];','v_provider_map jsonb;v_timezones text[];v_collection_diagnostics jsonb;');
  definition:=replace(definition,' v_backlogs:=private.dashboard_admin_pending_capture_heads',
   E' v_collection_diagnostics:=private.dashboard_admin_pending_collection_diagnostics(v_catalog,v_scope,greatest(date \'2000-01-01\',v_start-1),v_end,\n  array(select jsonb_array_elements_text(coalesce(p_request->\'providers\',\'[]\'::jsonb))));\n v_backlogs:=private.dashboard_admin_pending_capture_heads');
  definition:=replace(definition,'  v_day:=private.dashboard_admin_pending_capture_day(v_day,v_catalog,v_day_backlogs);',
   E'  v_day:=private.dashboard_admin_pending_capture_day(v_day,v_catalog,v_day_backlogs);\n  v_day:=private.dashboard_admin_pending_collection_day(v_day,v_collection_diagnostics);');
  definition:=replace(definition,$old$ for v_row in select value from jsonb_array_elements(v_day->'rows') loop$old$,
   E' for v_row in select value from jsonb_array_elements(v_day->\'rows\') loop\n  if v_row->>\'state\'=\'not_launched\' then continue;end if;');
  execute definition;
 end if;
 if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid=target)is distinct from old_metadata
  or(select md5(prosrc)from pg_proc where oid=target)<>'47e479ae7f88e4fcdeddf0a9c12a58c9'
  or(select md5(pg_get_functiondef(oid))from pg_proc where oid=target)<>'72a6d80d0e56fbe23d440d971bc807e4' then
  raise exception 'pending_diagnostics_metadata_drift';end if;
end $patch$;
do $verify$
declare h record;
begin
 for h in select * from(values
  ('private.dashboard_admin_pending_collection_diagnostics(jsonb,jsonb,date,date,text[])','34f15e9357221a542d59fd0952617e9e','ebe1881d874886bb856e94197afad593'),
  ('private.dashboard_admin_pending_collection_day(jsonb,jsonb)','3227da4ae537ae0d6a0c86ec0af59f0c','7aecd8a5c8bc8eab5ef3e453b8b31ab8')
 )v(signature,body_hash,definition_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(h.signature) and p.proowner='postgres'::regrole
   and not p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)=h.body_hash and md5(pg_get_functiondef(p.oid))=h.definition_hash)then raise exception 'pending_diagnostics_acl_drift';end if;
 end loop;
end $verify$;
notify pgrst,'reload schema';
commit;
