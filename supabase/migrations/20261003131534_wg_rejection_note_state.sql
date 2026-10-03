-- Distinguish unavailable WG rejection notes from verified empty source fields.
-- Hidden front/back text is source evidence, never an inferred rejection reason.
-- No source writes, collector changes, new helpers or grant changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare p record; before_metadata jsonb; after_metadata jsonb; definition text; old_fragment text; new_fragment text;
begin
 select f.* into p from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)');
 if not found then raise exception 'WG rejection reader baseline missing'; end if;
 if current_user<>'postgres' or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'s' or not p.prosecdef or p.proretset
  or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.prorettype<>'jsonb'::regtype or p.proargtypes<>'3802 3802'::oidvector
  or p.pronargs<>2 or p.pronargdefaults<>0 or p.proargnames<>array['p_request','p_scope']::text[]
  or p.proargmodes is not null or p.proallargtypes is not null or p.proargdefaults is not null
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
  or p.probin is not null or p.prosqlbody is not null or p.protrftypes is not null
  or p.proacl::text[] is distinct from array['postgres=X/postgres']::text[]
 then raise exception 'WG rejection reader metadata changed; review before applying'; end if;
 before_metadata:=pg_catalog.to_jsonb(p)-'prosrc';
 if pg_catalog.md5(p.prosrc)='459a967f2adb697d194e6fa2157f8096' then return; end if;
 if pg_catalog.md5(p.prosrc)<>'eaa58b63c49c9372d9b65bf22118b36f' then raise exception 'WG rejection reader production body changed; review before applying'; end if;
 definition:=pg_catalog.pg_get_functiondef(p.oid);
 old_fragment:=$old0$   case when d.status_code=7 then d.business_fields->>'rejection_reason' end raw_rejection_note$old0$;
 new_fragment:=$new0$   case when d.status_code=7 then d.business_fields->>'rejection_reason' end raw_rejection_note,
   d.business_fields as source_business_fields$new0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 0 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old1$ ), notes as materialized ($old1$;
 new_fragment:=$new1$ ), source_note_states as materialized (
  -- A withheld state alone also means a missing source key. Only its own
  -- sanitized field containing a known notice is evidence of hidden content.
  select o.*,array(select slot from (values
   ('remark',source_business_fields->>'note_state',source_business_fields->>'remark_sanitized'),
   ('front',source_business_fields->>'front_note_state',source_business_fields->>'front_note_sanitized'),
   ('back',source_business_fields->>'back_note_state',source_business_fields->>'back_note_sanitized')
  ) v(slot,state,sanitized) where state in('withheld','redacted') and (
   position('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实' in coalesce(sanitized,''))>0
   or position('未识别拦截原因，原文已隐藏，待核实' in coalesce(sanitized,''))>0)) hidden_note_sources,
  coalesce(source_business_fields->>'note_state','')='empty'
   and coalesce(source_business_fields->>'front_note_state','')='empty'
   and coalesce(source_business_fields->>'back_note_state','')='empty' all_notes_empty,
  jsonb_build_object('remark',case when source_business_fields->>'note_state' in('empty','template','redacted','withheld') then source_business_fields->>'note_state' else 'missing' end,
   'front',case when source_business_fields->>'front_note_state' in('empty','template','redacted','withheld') then source_business_fields->>'front_note_state' else 'missing' end,
   'back',case when source_business_fields->>'back_note_state' in('empty','template','redacted','withheld') then source_business_fields->>'back_note_state' else 'missing' end) source_note_states
  from orders o
 ), classified_orders as materialized (
  select o.*,case when rejection_note is not null then 'present' when cardinality(hidden_note_sources)>0 then 'withheld'
   when all_notes_empty then 'empty' else 'missing' end rejection_note_state from source_note_states o
 ), notes as materialized ($new1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 1 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old2$  select o.*,case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else coalesce(rejection_note,'（源备注为空）') end note,
   case when not blocking then coalesce(rejection_note,'（源备注为空）') end category
  from orders o where$old2$;
 new_fragment:=$new2$  select o.*,case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else
   coalesce(rejection_note,case rejection_note_state when 'withheld' then '（源业务备注已隐藏，驳回备注待核对）' when 'empty' then '（源备注为空）' else '（未采集到明确驳回备注）' end) end note,
   case when not blocking then coalesce(rejection_note,case rejection_note_state when 'withheld' then '（源业务备注已隐藏，驳回备注待核对）' when 'empty' then '（源备注为空）' else '（未采集到明确驳回备注）' end) end category
  from classified_orders o where$new2$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 2 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old3$  select n.*,case when blocking then md5(note) else private.dashboard_admin_live_rejection_exact_key(rejection_note) end note_key,
   case when not blocking then private.dashboard_admin_live_rejection_exact_key(rejection_note) end category_key$old3$;
 new_fragment:=$new3$  select n.*,case when blocking then md5(note) when rejection_note is not null or rejection_note_state='empty' then private.dashboard_admin_live_rejection_exact_key(rejection_note)
   else md5(jsonb_build_array('wg_source_rejection_note_state_v1',rejection_note_state)::text) end note_key,
   case when not blocking then case when rejection_note is not null or rejection_note_state='empty' then private.dashboard_admin_live_rejection_exact_key(rejection_note)
    else md5(jsonb_build_array('wg_source_rejection_note_state_v1',rejection_note_state)::text) end end category_key$new3$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 3 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old4$  select note reason,note_key "reasonKey",count(*) count,case when blocking and note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",$old4$;
 new_fragment:=$new4$  select note reason,note_key "reasonKey",count(*) count,min(rejection_note_state) rejection_note_state,
   case when not blocking then min(rejection_note) when note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when not blocking and min(rejection_note_state)<>'present' then null when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",$new4$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 4 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old5$  select category,category_key "categoryKey",count(*) count,min(rejection_note) "sourceReason",
   count(distinct rejection_note) "sourceVariantCount"$old5$;
 new_fragment:=$new5$  select category,category_key "categoryKey",count(*) count,min(rejection_note) "sourceReason",min(rejection_note_state) rejection_note_state,
   case when not blocking and min(rejection_note_state)<>'present' then null else count(distinct rejection_note) end "sourceVariantCount"$new5$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 5 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old6$count(distinct category_key) "categoryCount"$old6$;
 new_fragment:=$new6$case when blocking then count(distinct category_key) else count(distinct rejection_note) end "categoryCount"$new6$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 6 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old7$  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where$old7$;
 new_fragment:=$new7$  select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where$new7$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 7 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old8$  union all select to_jsonb(g)||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason)$old8$;
 new_fragment:=$new8$  union all select (to_jsonb(g)-'rejection_note_state')||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason)$new8$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 8 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old9$  union all select to_jsonb(g),g.count,g.category,null::timestamptz from categories$old9$;
 new_fragment:=$new9$  union all select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end,g.count,g.category,null::timestamptz from categories$new9$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 9 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old10$jsonb_build_object('rawRejectionReason',raw_rejection_note)$old10$;
 new_fragment:=$new10$jsonb_build_object('rawRejectionReason',raw_rejection_note,'rejectionNoteState',rejection_note_state,'sourceNoteStates',source_note_states,'hiddenNoteSources',to_jsonb(hidden_note_sources))$new10$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 10 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old11$jsonb_agg(to_jsonb(c) order by c.count desc,c.category)$old11$;
 new_fragment:=$new11$jsonb_agg((to_jsonb(c)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',c.rejection_note_state) else '{}'::jsonb end order by c.count desc,c.category)$new11$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 11 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old12$'operatorBasis','current_latest_operator') else '{}'::jsonb end,$old12$;
 new_fragment:=$new12$'operatorBasis','current_latest_operator') else jsonb_build_object(
     'missingReason',(select count(*) from notes where rejection_note_state='missing'),
     'withheldReason',(select count(*) from notes where rejection_note_state='withheld'),
     'emptyReason',(select count(*) from notes where rejection_note_state='empty'),
     'presentReason',(select count(*) from notes where rejection_note_state='present'),
     'knownReasonCount',(select count(distinct rejection_note) from notes)) end,$new12$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 12 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old13$jsonb_build_object('rejectionGrouping','exact_source_text_v1')$old13$;
 new_fragment:=$new13$jsonb_build_object('rejectionGrouping','exact_source_text_v1','rejectionNoteStateVersion','wg_source_note_state_v1')$new13$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG rejection reader anchor 13 changed'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select pg_catalog.to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>'459a967f2adb697d194e6fa2157f8096'
 then raise exception 'WG rejection reader OID, ACL, metadata or expected body drift'; end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
