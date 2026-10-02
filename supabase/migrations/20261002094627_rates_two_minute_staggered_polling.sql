-- Schedule-only candidate: existing rate jobs, fixed destinations/commands.
-- Apply only after one successful versioned publication; never return command
-- text or credentials, and never create a new job or grant new permissions.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $rate_polling$
declare j cron.job%rowtype; expected record; before_jobs jsonb; after_jobs jsonb;
begin
 if (select md5(prosrc) from pg_proc where oid='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure)
    is distinct from '1da790f7dc39d5f58d7444dc1fcff4bc'
 then raise exception 'rates_polling_publisher_drift';end if;
 if not exists(select 1 from private.fee_rate_generations where receipt->'ok'='true'::jsonb)
 then raise exception 'rates_polling_requires_successful_publication';end if;
 select jsonb_agg(to_jsonb(c)-'schedule' order by c.jobid) into before_jobs from cron.job c where c.jobid in(12,24);
 for expected in select * from (values
  (12::bigint,'third-party-rates-auto','45 * * * *','*/2 * * * *','cc27a71748a8a23985c4739c0cbb5bf6','bright-responder','sync-rates'),
  (24::bigint,'third-party-original-rates-auto','48 * * * *','1-59/2 * * * *','66cb1fcc5b9ac57adee4631ab6b7490d','sync-original-rate-sheet','sync')
 ) x(id,name,previous_schedule,next_schedule,command_hash,function_name,action_name) loop
  select * into j from cron.job where jobid=expected.id;
  if not found or j.jobname is distinct from expected.name or not j.active
    or j.database<>'postgres' or j.username<>'postgres' or j.schedule is distinct from expected.previous_schedule
    or md5(j.command) is distinct from expected.command_hash
    or position('https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/'||expected.function_name in j.command)=0
    or j.command !~ ('"action"[[:space:]]*:[[:space:]]*"'||expected.action_name||'"')
    or (select count(*) from regexp_matches(j.command,'net[.]http_post[[:space:]]*[(]','g'))<>1
  then raise exception 'rates_polling_job_drift';end if;
 end loop;
 perform cron.alter_job(12,schedule:='*/2 * * * *');
 perform cron.alter_job(24,schedule:='1-59/2 * * * *');
 select jsonb_agg(to_jsonb(c)-'schedule' order by c.jobid) into after_jobs from cron.job c where c.jobid in(12,24);
 if after_jobs is distinct from before_jobs then raise exception 'rates_polling_job_metadata_changed';end if;
 if (select schedule from cron.job where jobid=12)<>'*/2 * * * *'
  or (select schedule from cron.job where jobid=24)<>'1-59/2 * * * *'
 then raise exception 'rates_polling_schedule_not_applied';end if;
end $rate_polling$;
commit;
