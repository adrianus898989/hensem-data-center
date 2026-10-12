-- Switch only proved AR/IN/OKWIN summary without charts to narrow facts.
-- Source PK/native18/atomic trigger/NULL/day/future parity remain prerequisites.
-- Original money helper is applied only to qualified selected five-key facts.
-- Existing 91CLUB branch, authorization, every other source/operation and DTO
-- are byte-identical. No order data, readiness or permissions are written.
begin;set local statement_timeout='3s';set local lock_timeout='1s';
lock table public.ar_collected_orders in access share mode;
lock table private.ar_submission_typed_facts in access share mode;
do $patch$
declare p record;f record;spec record;before_metadata jsonb;after_metadata jsonb;v_body text;v_definition text;
begin
 if current_user<>'postgres'then raise exception 'AR_OKWIN_READER_ACTOR_DRIFT';end if;
 for spec in select * from(values ('private.ar_submission_fact_generation(text,text)','44e726b77cdbb15c8db7b0af81346a1b','s','text','p_country text, p_platform text'),
('private.ar_submission_fact_can_read(text,text,date,date)','59b1aaad5881647d9fb90dbb0074548d','s','boolean','p_country text, p_platform text, p_from date, p_to date'),
('private.begin_ar_submission_fact_day(text,text,date)','7a2baa8012a3e2edcb424acb6375f8ab','v','jsonb','p_country text, p_platform text, p_day date'),
('private.verify_ar_submission_fact_hour(text,text,date,integer)','62bf1bacee2360de92e3576c96a5ab4b','v','jsonb','p_country text, p_platform text, p_day date, p_hour integer'),
('private.approve_ar_submission_fact_day(text,text,date)','679ae551474718821cd1ee499775aff4','v','jsonb','p_country text, p_platform text, p_day date'),
('private.approve_ar_submission_fact_null(text,text)','e6609f1152ecbb5e13e81e29e5d72958','v','jsonb','p_country text, p_platform text'),
('private.approve_ar_submission_fact_future(text,text)','8cd45c0acae3b2ed96d489da8c4fb754','v','jsonb','p_country text, p_platform text'))v(signature,hash,volatility,result,arguments)loop
  select q.*,l.lanname into f from pg_proc q join pg_language l on l.oid=q.prolang where q.oid=to_regprocedure(spec.signature);
  if not found or md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>spec.volatility::"char"or f.proparallel<>'u'or f.lanname<>'plpgsql'or f.prorettype<>spec.result::regtype or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f'or f.pronargdefaults<>0 or f.provariadic<>0 or pg_get_function_arguments(f.oid)<>spec.arguments or f.proconfig is distinct from array['search_path=""']::text[]or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'AR_OKWIN_READER_PROOF_PREREQUISITE_DRIFT';end if;
 end loop;
 if private.ar_submission_fact_generation('IN','OKWIN')is null then raise exception 'AR_OKWIN_READER_GENERATION_INVALID';end if;
 select q.*,l.lanname into p from pg_proc q join pg_language l on l.oid=q.prolang where q.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s'or p.proparallel<>'u'or p.lanname<>'plpgsql'or p.prorettype<>'jsonb'::regtype or p.proretset or p.proisstrict or p.proleakproof or p.prokind<>'f'or p.pronargs<>1 or p.pronargdefaults<>0 or p.provariadic<>0 or pg_get_function_arguments(p.oid)<>'p_request jsonb'or pg_get_function_result(p.oid)<>'jsonb'or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']::text[]or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'or md5(p.prosrc)not in('a8f8bb5de7d906675f5176c5eb4fcb70','5b026afa37c300143302323eeccb6def')then raise exception 'AR_OKWIN_READER_METADATA_DRIFT';end if;
 before_metadata:=to_jsonb(p)-'prosrc'-'lanname';
 if md5(p.prosrc)='a8f8bb5de7d906675f5176c5eb4fcb70'then
  v_body:=p.prosrc;
  if length(v_body)-length(replace(v_body,$old$ if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and not v_charts$old$,''))<>length($old$ if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and not v_charts$old$)then raise exception 'AR_OKWIN_READER_FRAGMENT_DRIFT';end if;
  v_body:=replace(v_body,$old$ if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and not v_charts$old$,$new$ if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='OKWIN'
  and v_operation='summary' and not v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10'
  and to_regclass('private.ar_submission_typed_facts')is not null
  and to_regclass('private.ar_submission_fact_epoch')is not null
  and to_regclass('private.ar_submission_day_ready')is not null
  and to_regclass('private.ar_submission_null_ready')is not null
  and to_regclass('private.ar_submission_future_ready')is not null then
  -- Metadata AccessShare locks and same-statement native proof precede any
  -- narrow projected read. This pair is a physical source identity, not a grant.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_submission_typed_facts limit 0;
  perform 1 from private.ar_submission_fact_epoch limit 0;
  perform 1 from private.ar_submission_day_ready limit 0;
  perform 1 from private.ar_submission_null_ready limit 0;
  perform 1 from private.ar_submission_future_ready limit 0;
  if (select count(*)=2 from pg_proc p where p.oid in(to_regprocedure('private.ar_submission_fact_generation(text,text)'),to_regprocedure('private.ar_submission_fact_can_read(text,text,date,date)'))
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s'and p.proparallel='u'and p.prolang=(select oid from pg_language where lanname='plpgsql')and not p.proretset and not p.proisstrict and not p.proleakproof and p.prokind='f'and p.pronargdefaults=0 and p.provariadic=0 and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
   and((p.oid=to_regprocedure('private.ar_submission_fact_generation(text,text)')and md5(p.prosrc)='44e726b77cdbb15c8db7b0af81346a1b'and p.prorettype='text'::regtype and pg_get_function_arguments(p.oid)='p_country text, p_platform text') or (p.oid=to_regprocedure('private.ar_submission_fact_can_read(text,text,date,date)')and md5(p.prosrc)='59b1aaad5881647d9fb90dbb0074548d'and p.prorettype='boolean'::regtype and pg_get_function_arguments(p.oid)='p_country text, p_platform text, p_from date, p_to date')))then
   if private.ar_submission_fact_can_read(v_platform.scope_group,v_platform.source_name,(v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
    v_sql:=$q$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from private.ar_submission_typed_facts a where a.country_code=$2 and a.platform=$3 and $2::text='IN' and $3::text='OKWIN'
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from private.ar_submission_typed_facts a
 where a.country_code=$2 and a.platform=$3 and $2::text='IN'and $3::text='OKWIN'and a.status='已支付'
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
 from private.ar_submission_typed_facts a
 where a.country_code=$2 and a.platform=$3 and $2::text='IN' and $3::text='OKWIN'
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0 and count(distinct o.order_id)=count(*)
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
   from private.ar_submission_typed_facts a
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
$q$;
   end if;
  end if;
 end if;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and not v_charts$new$);
  if md5(v_body)<>'5b026afa37c300143302323eeccb6def'then raise exception 'AR_OKWIN_READER_AFTERHASH_DRIFT';end if;
  v_definition:=pg_get_functiondef(p.oid);
  if position(p.prosrc in v_definition)=0 then raise exception 'AR_OKWIN_READER_DEFINITION_DRIFT';end if;
  execute replace(v_definition,p.prosrc,v_body);
 end if;
 select to_jsonb(q)-'prosrc'into after_metadata from pg_proc q where q.oid=p.oid;
 if after_metadata is distinct from before_metadata or(select md5(prosrc)from pg_proc where oid=p.oid)<>'5b026afa37c300143302323eeccb6def'then raise exception 'AR_OKWIN_READER_POST_METADATA_DRIFT';end if;
end;$patch$;
commit;
