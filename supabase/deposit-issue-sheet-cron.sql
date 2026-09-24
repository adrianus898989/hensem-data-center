-- Keep the private deposit-not-received read model close to the Google source.
-- Uses the existing third_party_sync_secret Vault entry; no legacy job is changed.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='deposit-issue-sheet-sync'
  loop perform cron.unschedule(r.jobid); end loop;
end $$;
select cron.schedule(
  'deposit-issue-sheet-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/sync-deposit-issue-sheet',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name='third_party_sync_secret' limit 1)
    ),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
commit;
