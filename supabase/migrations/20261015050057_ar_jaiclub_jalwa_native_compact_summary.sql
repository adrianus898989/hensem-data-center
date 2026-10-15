-- Native JAICLUB/JALWA compact summaries; full DTO, authorization and MAAN selector are preserved.
-- No new source objects, proof, cache, upstream completeness claim or business data writes.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';set local timezone='UTC';set local search_path='';
lock table public.ar_collected_orders in access share mode nowait;
do $install$
declare current_body text;definition text;original_metadata jsonb;
begin
 if current_user<>'postgres'then raise exception'native_summary_owner_only';end if;
 if not exists(select 1 from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)')
   and f.proowner='postgres'::regrole and l.lanname='plpgsql'
   and f.prokind='f' and f.provolatile='s' and f.proparallel='u'
   and f.prosecdef and not f.proisstrict and not f.proleakproof and not f.proretset
   and f.prorettype='jsonb'::regtype and f.pronargs=1 and f.pronargdefaults=0 and f.provariadic=0
   and f.proargtypes='3802'::oidvector and f.proallargtypes is null and f.proargmodes is null
   and f.proargnames=array['p_request']::text[] and f.proargdefaults is null
   and f.procost=100 and f.prorows=0
   and f.proconfig=array['search_path=""','jit=off','enable_nestloop=off']::text[]
   and f.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
   and pg_get_function_arguments(f.oid)='p_request jsonb'
   and pg_get_function_result(f.oid)='jsonb')then raise exception'native_summary_metadata_drift';end if;
 if not coalesce(((select count(*)=2 from pg_attribute a where a.attrelid='public.ar_collected_orders'::regclass
    and a.attname in('member_level','recharge_count')and a.attnum>0 and not a.attisdropped
    and a.atttypid='integer'::regtype and a.atttypmod=-1 and not a.atthasdef
    and a.attgenerated=''and a.attidentity='')
  and not exists(select 1 from pg_inherits where inhparent='public.ar_collected_orders'::regclass or inhrelid='public.ar_collected_orders'::regclass)
  and exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid='public.ar_collected_orders'::regclass and c.contype='p'
    and c.convalidated and not c.condeferrable and not c.condeferred
    and i.indisprimary and i.indisunique and i.indimmediate and i.indisvalid and i.indisready and i.indislive
    and i.indpred is null and i.indexprs is null
    and pg_get_constraintdef(c.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(p.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'and p.proowner='postgres'::regrole
    and p.prolang=(select oid from pg_language where lanname='sql')and p.provolatile='i'and p.proparallel='s'
    and not p.prosecdef and not p.proisstrict and not p.proleakproof and not p.proretset
    and p.prorettype='numeric'::regtype and p.pronargs=8 and p.pronargdefaults=0 and p.provariadic=0
    and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
    and pg_get_function_arguments(p.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric')),false)then raise exception'native_summary_native_prerequisite_drift';end if;
 select prosrc,to_jsonb(f)-'prosrc'into current_body,original_metadata from pg_proc f
  where f.oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure;
 if md5(current_body)='08f4fda2ac67706ff667addfca4ffdf2'then return;end if;
 if md5(current_body)is distinct from '3a8012390d65b3a698c749bee099d0d0'then raise exception'native_summary_definition_drift';end if;
 definition:=pg_get_functiondef('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,$old$ execute v_sql into v_result using $old$,'')))/length($old$ execute v_sql into v_result using $old$)<>1 then raise exception'native_summary_anchor_drift';end if;
 definition:=replace(definition,$old$ execute v_sql into v_result using $old$,$new$ -- ar_native_compact_summary_v1: reuse the existing exact compact summary
 -- algorithm for these two native scopes, without facts, proof or new objects.
 -- Native full5PK proves order_id uniqueness; integer bounds preserve old text
 -- parsing. Keep blank-ID/ALL-history NULL exclusions and independent paid day.
 if v_platform.source='ar' and v_platform.scope_group='IN'
  and v_platform.source_name in('JAICLUB','JALWA')
  and v_operation='summary' and not v_charts then
  perform 1 from public.ar_collected_orders limit 0;
  if(select count(*)=2 from pg_attribute a where a.attrelid='public.ar_collected_orders'::regclass
    and a.attname in('member_level','recharge_count')and a.attnum>0 and not a.attisdropped
    and a.atttypid='integer'::regtype and a.atttypmod=-1 and not a.atthasdef
    and a.attgenerated=''and a.attidentity='')
  and not exists(select 1 from pg_inherits where inhparent='public.ar_collected_orders'::regclass or inhrelid='public.ar_collected_orders'::regclass)
  and exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid='public.ar_collected_orders'::regclass and c.contype='p'
    and c.convalidated and not c.condeferrable and not c.condeferred
    and i.indisprimary and i.indisunique and i.indimmediate and i.indisvalid and i.indisready and i.indislive
    and i.indpred is null and i.indexprs is null
    and pg_get_constraintdef(c.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(p.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'and p.proowner='postgres'::regrole
    and p.prolang=(select oid from pg_language where lanname='sql')and p.provolatile='i'and p.proparallel='s'
    and not p.prosecdef and not p.proisstrict and not p.proleakproof and not p.proretset
    and p.prorettype='numeric'::regtype and p.pronargs=8 and p.pronargdefaults=0 and p.provariadic=0
    and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
    and pg_get_function_arguments(p.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric') then
  v_sql:=$ar_native_compact$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from public.ar_collected_orders a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$ar_native_compact$;
  end if;
 end if;
 execute v_sql into v_result using $new$);
 execute definition;
 if (select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)is distinct from '08f4fda2ac67706ff667addfca4ffdf2'
  or(select to_jsonb(f)-'prosrc'from pg_proc f where f.oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)is distinct from original_metadata
 then raise exception'native_summary_after_assertion_failed';end if;
end;$install$;
commit;
