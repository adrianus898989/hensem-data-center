-- Shared employee follow-up read model: use real server create/follow time for portal rows.
-- Sheet dates and ordering, authorization, mirror version guards and receipt semantics stay unchanged.
-- Exact deployed definitions and ACLs are guarded. No business rows are written.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';

do $migration$
declare
 target regprocedure:='private.dashboard_admin_live_deposit_issues(jsonb)'::regprocedure;
 definition text; original_metadata jsonb; old_fragment text; new_fragment text;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,original_metadata from pg_proc p where p.oid=target;
 if md5(definition) <> '2c2e15758db3aa749a8e5eff6ebdb424' then raise exception 'followup_shared_saved_time: admin definition drift'; end if;
 if (select proacl::text from pg_proc where oid=target) is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'followup_shared_saved_time: admin ACL drift'; end if;
 if (select proowner::regrole::text from pg_proc where oid=target) is distinct from 'postgres' then raise exception 'followup_shared_saved_time: admin owner drift'; end if;
 old_fragment:=$old_0$  select e.*,n.display_country,n.display_platform,n.platform_key,upper(btrim(order_number)) as order_key$old_0$;
 new_fragment:=$new_0$  select e.*,n.display_country,n.display_platform,n.platform_key,upper(btrim(order_number)) as order_key,
   case when e.source_kind='portal' then coalesce(nullif(e.portal_payload->>'last_follow_at',''),nullif(e.portal_payload->>'created_at',''))::timestamptz end as portal_saved_at$new_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: admin replacement 0 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_1$e.source_date_text,r.upi_id,r.kyc_upi_id
$old_1$;
 new_fragment:=$new_1$e.source_date_text,r.upi_id,r.kyc_upi_id,null::timestamptz as portal_saved_at
$new_1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: admin replacement 1 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_2$e.order_number,e.utr,e.amount,e.provider,e.followup_date,r.unreceived_days,r.match_status,$old_2$;
 new_fragment:=$new_2$e.order_number,e.utr,e.amount,e.provider,
   case when e.source_kind='portal' then (e.portal_saved_at at time zone 'Asia/Kolkata')::date else e.followup_date end,
   r.unreceived_days,r.match_status,$new_2$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: admin replacement 2 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_3$e.source_date_text,e.upi_id,e.kyc_upi_id
$old_3$;
 new_fragment:=$new_3$e.source_date_text,e.upi_id,e.kyc_upi_id,e.portal_saved_at
$new_3$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: admin replacement 3 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_4$order by record_date desc nulls last,display_platform,source_row,id$old_4$;
 new_fragment:=$new_4$order by record_date desc nulls last,portal_saved_at desc nulls last,display_platform,source_row,id$new_4$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: admin replacement 4 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_5$order by p.record_date desc nulls last,p.display_platform,p.source_row,p.id$old_5$;
 new_fragment:=$new_5$order by p.record_date desc nulls last,p.portal_saved_at desc nulls last,p.display_platform,p.source_row,p.id$new_5$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: admin replacement 5 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from original_metadata then raise exception 'followup_shared_saved_time: function metadata changed'; end if;
end;
$migration$;

do $migration$
declare
 target regprocedure:='public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure;
 definition text; original_metadata jsonb; old_fragment text; new_fragment text;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,original_metadata from pg_proc p where p.oid=target;
 if md5(definition) <> '19fb69fe875f488e75d3c819e53d5508' then raise exception 'followup_shared_saved_time: portal definition drift'; end if;
 if (select proacl::text from pg_proc where oid=target) is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'followup_shared_saved_time: portal ACL drift'; end if;
 if (select proowner::regrole::text from pg_proc where oid=target) is distinct from 'postgres' then raise exception 'followup_shared_saved_time: portal owner drift'; end if;
 old_fragment:=$old_0$ select r.*,
$old_0$;
 new_fragment:=$new_0$ select r.*,
 case when r.source_kind='portal' then coalesce(nullif(r.portal_payload->>'last_follow_at',''),nullif(r.portal_payload->>'created_at',''))::timestamptz end as portal_saved_at,
$new_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: portal replacement 0 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_1$order by query_date desc nulls last,source_row desc,id$old_1$;
 new_fragment:=$new_1$order by query_date desc nulls last,portal_saved_at desc nulls last,source_row desc,id$new_1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: portal replacement 1 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_2$jsonb_agg(to_jsonb(p)) from page p$old_2$;
 new_fragment:=$new_2$jsonb_agg(to_jsonb(p) order by p.query_date desc nulls last,p.portal_saved_at desc nulls last,p.source_row desc,p.id) from page p$new_2$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'followup_shared_saved_time: portal replacement 2 drift'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from original_metadata then raise exception 'followup_shared_saved_time: function metadata changed'; end if;
end;
$migration$;

notify pgrst,'reload schema';
commit;
