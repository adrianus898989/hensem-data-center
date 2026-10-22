-- One explicit maintenance cleanup; never changes function fingerprints or schedules.
begin;
do $owner$begin if current_user<>'postgres'then raise exception using errcode='42501',message='created_rollout_owner_required';end if;end;$owner$;
delete from private.created_cohort_manual_transition where valid_until<=statement_timestamp();
commit;
