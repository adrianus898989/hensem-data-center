-- Only hide a non-consumed repeated internal JSON field outside order-detail views.
-- Source-note normalization, classification, group keys, public fields and financial values are unchanged.
begin;set local lock_timeout='3s';set local statement_timeout='15s';
do $patch$declare d record;p pg_proc%rowtype;definition text;patched text;before_meta jsonb;begin
 if current_user<>'postgres'then raise exception 'OWNER_REQUIRED';end if;
 for d in select *from(values ('private.dashboard_admin_live_withdraw_reasons(jsonb)','bbd30a9d84eb96e7e9c82886f92656e0','6fa3e518df4900294a31dc6c9ee65438'),('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)','7c63b8220cd8be35423a1f3d93039447','5701546be4265b198eeb45b823717c6c'),('private.dashboard_admin_live_blocking_details_cleaned(text)','17122a5ed74374c036bd19b073088031','9b368a8dee1bee462c24b8bd9b97b760'))x(signature,body_md5,definition_md5)loop
  if not exists(select 1 from pg_proc fp where fp.oid=to_regprocedure(d.signature)and fp.proowner='postgres'::regrole and md5(fp.prosrc)=d.body_md5 and md5(pg_get_functiondef(fp.oid))=d.definition_md5)then raise exception 'AR_NOTE_PROJECTION_BASELINE_DRIFT';end if;
 end loop;
 select *into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'or not p.prosecdef
  or p.proconfig is distinct from array['search_path=""','plan_cache_mode=force_custom_plan']::text[]then raise exception 'AR_NOTE_PROJECTION_METADATA_DRIFT';end if;
 before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,$old$end rejection_note,c.clean_note source_note,c.category,c.blocking_details,$old$,'')))/length($old$end rejection_note,c.clean_note source_note,c.category,c.blocking_details,$old$)<>1 then raise exception 'AR_NOTE_PROJECTION_EXACT_ANCHOR_REQUIRED';end if;
 patched:=replace(definition,$old$end rejection_note,c.clean_note source_note,c.category,c.blocking_details,$old$,$new$end rejection_note,c.clean_note source_note,c.category,case when v_kind in('orders','blockingOrders') then c.blocking_details end blocking_details,$new$);
 if md5(patched)<>'2662266ad8caf056282a16765f84a227'then raise exception 'AR_NOTE_PROJECTION_CONSTRUCTION_DRIFT';end if;
 execute patched;
 select *into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'4dcc9f7eb3d7b7501122cb39458dcc92'or md5(pg_get_functiondef(p.oid))<>'2662266ad8caf056282a16765f84a227'or(to_jsonb(p)-'prosrc')is distinct from before_meta then raise exception 'AR_NOTE_PROJECTION_POST_MISMATCH';end if;
end;$patch$;
commit;
