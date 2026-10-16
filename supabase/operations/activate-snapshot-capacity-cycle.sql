-- Run after the exact capacity-cycle patch and prior independent maintenance.
-- No direct writes/row locks on managed cron.job: use its supported API.
begin;set local statement_timeout='3s';set local lock_timeout='500ms';
do $activate$
declare e record;begin
 if current_user<>'postgres'then raise exception 'snapshot_cycle_denied';end if;
 if not pg_try_advisory_xact_lock(hashtext('provider_snapshot_maintenance_activation_v1'))then raise exception 'snapshot_cycle_busy';end if;
 for e in select *from(values
 ('private.provider_snapshot_retire_closed_cycle()','423ed69e31e50a1476fe89f1b809615e'),
 ('private.provider_snapshot_retire_intraday(uuid)','121c25849b0328e5ed643e4d2b63ee94'),
 ('private.provider_snapshot_closed_replacement(uuid)','7bc228f7322f07f4bcf12735437211f0'),
 ('private.provider_snapshot_archive_closed_storage(integer)','853277f02191dcbb609028a459fd1083')
 )v(sig,hash)loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(e.sig)and md5(prosrc)=e.hash and pg_get_userbyid(proowner)='postgres'and not prosecdef and proacl::text='{postgres=X/postgres}'and proconfig=array['search_path=""'])then raise exception 'snapshot_cycle_helper_drift';end if;
 end loop;
 if exists(select 1 from cron.job where jobname='provider-snapshot-closed-retirement-v1')then raise exception 'snapshot_cycle_job_exists';end if;
 if not exists(select 1 from cron.job where jobname='provider-snapshot-maintenance-v1'and username=current_user and database=current_database()and active and schedule='*/5 * * * *'and command=$gc$begin;set local statement_timeout='5s';set local lock_timeout='500ms';select private.provider_snapshot_gc_versions(100);commit;$gc$)
 or not exists(select 1 from cron.job where jobname='provider-snapshot-storage-archive-v1'and username=current_user and database=current_database()and active and schedule='* * * * *'and command=$storage$begin;set local statement_timeout='5s';set local lock_timeout='500ms';select private.provider_snapshot_archive_closed_storage(100);commit;$storage$)then raise exception 'snapshot_cycle_maintenance_not_active';end if;
 perform cron.schedule('provider-snapshot-closed-retirement-v1','* * * * *',$retire$begin;set local statement_timeout='5s';set local lock_timeout='500ms';select private.provider_snapshot_retire_closed_cycle();commit;$retire$);
end;$activate$;
commit;
