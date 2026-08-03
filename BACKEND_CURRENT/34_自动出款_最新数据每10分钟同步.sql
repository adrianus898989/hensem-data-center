-- 34_自动出款_最新数据每10分钟同步.sql
-- 目的：解决“RAW/Google 已录入，但几十分钟后 Supabase 仍没有更新”的问题。
-- 逻辑：每 10 分钟重新同步“昨日”自动出款 + 提现操作人数据。
-- 网页刷新只会重新查询 Supabase；真正的数据写入由这个 Cron 完成。
-- 使用现有 Vault secret：third_party_sync_secret，不把 Secret 明文写在 SQL 里。

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.run_auto_withdraw_latest_sync_once()
returns bigint
language plpgsql
security definer
set search_path = public, cron, net, vault
as $$
declare
  v_secret text;
  v_request_id bigint;
  v_date date;
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'third_party_sync_secret'
  limit 1;

  if coalesce(v_secret, '') = '' then
    raise exception 'Vault secret third_party_sync_secret 不存在';
  end if;

  -- 与当前后台日期逻辑保持一致：Asia/Manila 的昨日
  v_date := ((now() at time zone 'Asia/Manila')::date - 1);

  select net.http_post(
    url := 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/sync-auto-withdraw-raw',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_secret
    ),
    body := jsonb_build_object(
      'action', 'sync-date',
      'date', to_char(v_date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 120000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.run_auto_withdraw_latest_sync_once()
from public, anon, authenticated;

grant execute on function public.run_auto_withdraw_latest_sync_once()
to service_role;

-- 防止重复创建同名任务
do $$
declare
  r record;
begin
  for r in
    select jobid
    from cron.job
    where jobname = 'auto-withdraw-latest-sync'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

-- 每 10 分钟刷新昨日最新 RAW 数据
select cron.schedule(
  'auto-withdraw-latest-sync',
  '*/10 * * * *',
  $$
  select public.run_auto_withdraw_latest_sync_once();
  $$
);

-- 立即触发一次，不必等下一轮 10 分钟
select public.run_auto_withdraw_latest_sync_once() as immediate_request_id;

-- 检查任务
select
  jobid,
  jobname,
  schedule,
  active
from cron.job
where jobname = 'auto-withdraw-latest-sync';
