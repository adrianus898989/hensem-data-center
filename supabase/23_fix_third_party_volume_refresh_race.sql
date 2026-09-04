-- Fix the current/previous-day third-party volume refresh race.
--
-- The Google raw workbook is refreshed around minute 37. The previous payout
-- job used to run at minute 35, so it could successfully read the workbook
-- just before new rows were published and then leave the dashboard stale for
-- another hour. Retry each current/previous direction every 20 minutes and
-- stagger the jobs to avoid four simultaneous Edge Function executions.

do $$
declare
  item record;
begin
  for item in
    select *
    from (values
      ('third-party-current-collect'::text,  '5,25,45 * * * *'::text),
      ('third-party-current-payout'::text,  '10,30,50 * * * *'::text),
      ('third-party-previous-collect'::text, '15,35,55 * * * *'::text),
      ('third-party-previous-payout'::text, '0,20,40 * * * *'::text)
    ) as schedules(jobname, schedule)
  loop
    perform cron.alter_job(
      job_id := (select jobid from cron.job where jobname = item.jobname limit 1),
      schedule := item.schedule
    );
  end loop;
end $$;

select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'third-party-current-collect',
  'third-party-current-payout',
  'third-party-previous-collect',
  'third-party-previous-payout'
)
order by jobname;
