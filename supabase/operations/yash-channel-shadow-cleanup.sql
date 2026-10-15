-- Save the aggregate release receipt before this one-time cleanup.
-- Never removes jobs, cohorts, immutable published artifacts or the final YASH helper.
begin;
set local statement_timeout='3s';set local lock_timeout='500ms';
do $cleanup$
declare r record;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 lock table private.yash_channel_shadow_batches,private.yash_channel_shadow_items in access exclusive mode;
 if exists(select 1 from private.yash_channel_shadow_batches where status<>'promoted')then raise exception 'yash_shadow_active_stage';end if;
 if not exists(select 1 from private.yash_channel_shadow_batches where status='promoted')then raise exception 'yash_shadow_no_promotion_receipt';end if;
 for r in select p.oid::regprocedure::text signature from pg_proc p where p.pronamespace='private'::regnamespace
  and left(p.proname,20)='yash_channel_shadow_'order by p.proname loop
  execute 'drop function '||r.signature;
 end loop;
end;$cleanup$;
drop table private.yash_channel_shadow_items;
drop table private.yash_channel_shadow_batches;
commit;
