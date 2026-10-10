-- Share canonical blocking rules across WG/AR/PANDA while retaining source
-- originals. Treat hidden/empty/unrecorded explanations as provenance, not
-- evidence of a risk rule. Exact rejection/state/verified overlays stay intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare p record;helper record;definition text;before_metadata jsonb;after_metadata jsonb;
begin
 select f.*,pg_catalog.pg_get_userbyid(f.proowner) owner_name into p from pg_catalog.pg_proc f
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)');
 if not found or p.owner_name<>'postgres' or p.prosecdef is not true or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres}'
  or md5(p.prosrc) not in('77a2a379170e614b2d38b84bdb706055','bcd4383775c2d02894bcfa64d3a31a3b') then
  raise exception 'wg_blocking_canonical_reader_drift';end if;
 select f.*,pg_catalog.pg_get_userbyid(f.proowner) owner_name into helper from pg_catalog.pg_proc f
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_blocking_details_cleaned(text)');
 if not found or helper.owner_name<>'postgres' or helper.prosecdef or helper.provolatile<>'i'
  or helper.proconfig is distinct from array['search_path=""']::text[]
  or helper.proacl::text is distinct from '{postgres=X/postgres}'
  or md5(helper.prosrc)<>'646a277faed684caa72fc427f4f53e75' then
  raise exception 'wg_blocking_canonical_helper_drift';end if;
 if md5(p.prosrc)='bcd4383775c2d02894bcfa64d3a31a3b' then return;end if;
 select to_jsonb(f)-'prosrc' into before_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 definition:=pg_catalog.pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,$old_0$ ), orders as materialized (
  select o.*,f.normalized_note from source_orders o join note_flags f on f.raw_note=coalesce(o.blocking_note,'')$old_0$,'')))/length($old_0$ ), orders as materialized (
  select o.*,f.normalized_note from source_orders o join note_flags f on f.raw_note=coalesce(o.blocking_note,'')$old_0$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_0';end if;
 definition:=replace(definition,$old_0$ ), orders as materialized (
  select o.*,f.normalized_note from source_orders o join note_flags f on f.raw_note=coalesce(o.blocking_note,'')$old_0$,$new_0$ ), blocking_values as materialized (
  -- Only manual blocking notes use the shared rule classifier. Rejection
  -- state/exact text and verified evidence remain on their independent path.
  select f.raw_note,case when f.normalized_note ~ '[^[:space:]]'
   then private.dashboard_admin_live_blocking_details_cleaned(f.normalized_note)
   else jsonb_build_object('reason','检测没备注') end blocking_details
  from note_flags f where blocking and f.raw_note in (
   select coalesce(o.blocking_note,'') from source_orders o where o.blocking_operator_class='manual')
 ), orders as materialized (
  select o.*,f.normalized_note,b.blocking_details,
   case when f.normalized_note ~ '[^[:space:]]' then
    case when o.source_business_fields->>'note_state' in('withheld','redacted') and (
     position('未识别拦截原因，原文已隐藏，待核实' in f.normalized_note)>0
     or position('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实' in f.normalized_note)>0)
     then 'withheld' else 'present' end
    when o.source_business_fields->>'note_state'='empty'
     and o.source_business_fields->>'front_note_state'='empty'
     and o.source_business_fields->>'back_note_state'='empty' then 'empty' else 'missing' end blocking_note_state
  from source_orders o join note_flags f on f.raw_note=coalesce(o.blocking_note,'')
  left join blocking_values b on b.raw_note=f.raw_note$new_0$);
 if (length(definition)-length(replace(definition,$old_1$count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
   count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason$old_1$,'')))/length($old_1$count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
   count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason$old_1$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_1';end if;
 definition:=replace(definition,$old_1$count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
   count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason$old_1$,$new_1$count(*) filter(where blocking_operator_class='manual' and blocking_note_state='present')::bigint "manualWithReason",
  count(*) filter(where blocking_operator_class='manual' and blocking_note_state in('empty','missing'))::bigint "manualWithoutReason",
  count(*) filter(where blocking_operator_class='manual' and blocking_note_state='withheld')::bigint "manualWithheldReason$new_1$);
 if (length(definition)-length(replace(definition,$old_2$case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else$old_2$,'')))/length($old_2$case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else$old_2$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_2';end if;
 definition:=replace(definition,$old_2$case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else$old_2$,$new_2$case when blocking then case when blocking_note_state='withheld' then '拦截说明已隐藏' when blocking_note_state in('empty','missing') then '检测没备注' else coalesce(blocking_details->>'reason',normalized_note) end else$new_2$);
 if (length(definition)-length(replace(definition,$old_3$case when blocking then md5(note) when rejection_note$old_3$,'')))/length($old_3$case when blocking then md5(note) when rejection_note$old_3$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_3';end if;
 definition:=replace(definition,$old_3$case when blocking then md5(note) when rejection_note$old_3$,$new_3$case when blocking then case when blocking_note_state='withheld' then md5(jsonb_build_array('wg_blocking_note_state_v1','withheld')::text) else md5(note) end when rejection_note$new_3$);
 if (length(definition)-length(replace(definition,$old_4$case when not blocking then min(rejection_note) when note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when not blocking and min(rejection_note_state)<>'present' then null when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",$old_4$,'')))/length($old_4$case when not blocking then min(rejection_note) when note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when not blocking and min(rejection_note_state)<>'present' then null when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",$old_4$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_4';end if;
 definition:=replace(definition,$old_4$case when not blocking then min(rejection_note) when note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when not blocking and min(rejection_note_state)<>'present' then null when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",$old_4$,$new_4$case when not blocking then min(rejection_note) else min(blocking_note) filter(where blocking_note_state='present') end "sourceReason",
  case when not blocking and min(rejection_note_state)<>'present' then null when blocking and bool_and(blocking_note_state='withheld') then null
   when blocking then count(distinct blocking_note) filter(where blocking_note_state='present') else 1::bigint end "sourceVariantCount",
  case when count(distinct blocking_note_state)=1 then min(blocking_note_state) else 'mixed' end blocking_note_state,
  jsonb_build_object('empty',count(*) filter(where blocking_note_state='empty'),'missing',count(*) filter(where blocking_note_state='missing'),
   'withheld',count(*) filter(where blocking_note_state='withheld'),'present',count(*) filter(where blocking_note_state='present')) blocking_note_states,$new_4$);
 if (length(definition)-length(replace(definition,$old_5$ ), categories as (
  select category,category_key$old_5$,'')))/length($old_5$ ), categories as (
  select category,category_key$old_5$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_5';end if;
 definition:=replace(definition,$old_5$ ), categories as (
  select category,category_key$old_5$,$new_5$ ), variant_groups as (
  -- Drill by the same canonical key; retain each provided original note.
  -- Empty/missing/hidden source text is unavailable, not an invented rule.
  select case when blocking_note_state='present' then blocking_note end reason,
   case when blocking_note_state='present' then blocking_note end "sourceReason",
   note "canonicalReason",note_key "reasonKey",count(*) count,
   case when count(distinct blocking_note_state)=1 then min(blocking_note_state) else 'mixed' end "blockingNoteState",
   jsonb_build_object('empty',count(*) filter(where blocking_note_state='empty'),'missing',count(*) filter(where blocking_note_state='missing'),
    'withheld',count(*) filter(where blocking_note_state='withheld'),'present',count(*) filter(where blocking_note_state='present')) "blockingNoteStates",
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other
  from selected where blocking group by 1,2,3,4
 ), categories as (
  select category,category_key$new_5$);
 if (length(definition)-length(replace(definition,$old_6$select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups$old_6$,'')))/length($old_6$select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups$old_6$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_6';end if;
 definition:=replace(definition,$old_6$select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups$old_6$,$new_6$select (to_jsonb(g)-'rejection_note_state'-'blocking_note_state'-'blocking_note_states')||case when blocking then jsonb_build_object('blockingNoteState',g.blocking_note_state,'blockingNoteStates',g.blocking_note_states) else jsonb_build_object('rejectionNoteState',g.rejection_note_state) end item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups$new_6$);
 if (length(definition)-length(replace(definition,$old_7$union all select (to_jsonb(g)-'rejection_note_state')||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'$old_7$,'')))/length($old_7$union all select (to_jsonb(g)-'rejection_note_state')||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'$old_7$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_7';end if;
 definition:=replace(definition,$old_7$union all select (to_jsonb(g)-'rejection_note_state')||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'$old_7$,$new_7$union all select to_jsonb(g),g.count,g.reason,null::timestamptz from variant_groups g where k='blockingVariants'$new_7$);
 if (length(definition)-length(replace(definition,$old_8$'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null)||case when not blocking then$old_8$,'')))/length($old_8$'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null)||case when not blocking then$old_8$)<>1 then
  raise exception 'wg_blocking_canonical_fragment_drift_8';end if;
 definition:=replace(definition,$old_8$'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null)||case when not blocking then$old_8$,$new_8$'blockingReason',case when blocking then note end,
   'blockingActualValue',case when blocking and blocking_note_state='present' then blocking_details->>'actualValue' end,
   'blockingActualField',case when blocking and blocking_note_state='present' then blocking_details->>'actualField' end,
   'blockingThreshold',case when blocking and blocking_note_state='present' then blocking_details->>'threshold' end)
   ||case when blocking then jsonb_build_object('blockingNoteState',blocking_note_state) else '{}'::jsonb end||case when not blocking then$new_8$);
 execute definition;
 select to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if (select md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>'bcd4383775c2d02894bcfa64d3a31a3b' or after_metadata is distinct from before_metadata then
  raise exception 'wg_blocking_canonical_result_drift';end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
