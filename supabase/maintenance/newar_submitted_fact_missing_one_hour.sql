-- One native hour only. Change the same three constants as the repair template.
-- Never replace this with an all-day/all-platform scan or increase the 3s budget.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='1s';
select set_config('newar_submit_read.platform','MAANWIN',true),
 set_config('newar_submit_read.from','2026-10-09T18:30:00Z',true),
 set_config('newar_submit_read.to','2026-10-09T19:30:00Z',true);
do $scope$
declare v_platform text:=current_setting('newar_submit_read.platform');
 v_from timestamptz:=current_setting('newar_submit_read.from')::timestamptz;
 v_to timestamptz:=current_setting('newar_submit_read.to')::timestamptz;
begin
 if current_user<>'postgres' or v_platform not in('MAANWIN','DhaniWin') or not isfinite(v_from) or not isfinite(v_to)
  or v_from<timestamp '2026-10-10' at time zone 'Asia/Kolkata' or v_to<=v_from or v_to-v_from>interval '1 hour'
  or not exists(select 1 from public.newar_detail_platforms n where n.platform=v_platform and n.country_code='IN' and n.timezone='Asia/Kolkata')
  then raise exception 'NEWAR_SUBMIT_READ_SCOPE_INVALID';end if;
end;$scope$;
with params as materialized (
 select current_setting('newar_submit_read.platform') platform,
  current_setting('newar_submit_read.from')::timestamptz lo,current_setting('newar_submit_read.to')::timestamptz hi
), candidates as materialized (
 select f.record_id,f.platform,f.source_id,f.created_at
 from params p join private.newar_withdraw_facts f
  on f.platform=p.platform and f.created_at>=p.lo and f.created_at<p.hi
 where f.submitted_at is null
), parsed as materialized (
 select case when n.platform=f.platform and n.dataset='withdraw' and n.source_id=f.source_id and n.created_at=f.created_at
  and n.raw->>'businessSchemaVersion'='2' and n.raw->>'sourceSubmittedSourceField'='submittedTime'
  then private.newar_stats_time(n.raw->>'sourceSubmittedAt') end parsed_submitted
 from candidates f cross join lateral (
  select n.platform,n.dataset,n.source_id,n.created_at,n.raw from public.newar_detail_records n
  where n.id=f.record_id offset 0
 ) n
)
select current_setting('newar_submit_read.platform') platform,
 current_setting('newar_submit_read.from') interval_start,current_setting('newar_submit_read.to') interval_end,
 count(*) missing_typed_source_candidates,count(parsed_submitted) eligible_missing,
 'zero proves this received-field interval only, not upstream completeness'::text verification_limit
from parsed;
rollback;
