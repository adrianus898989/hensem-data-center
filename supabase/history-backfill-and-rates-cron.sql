-- 08_历史数据自动补齐_费率自动更新_待执行
-- 作用：
-- 1) 建立 2026-04-01 到“上个月最后一天”的历史补齐队列；每个日期拆成 代收 / 代付 两个任务。
-- 2) 每 5 分钟调用一次 bright-responder 的 sync-history-next；每次最多补同方向连续 3 天，兼顾速度与内存。
-- 3) 费率 / 盘口状态每 6 小时自动同步一次。
-- 4) 已完成历史任务不会重复读取 Google；当前/昨日仍由原来的 4 个每小时 Cron 负责。

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.third_party_history_backfill (
  data_date date not null,
  direction text not null check (direction in ('代收','代付')),
  status text not null default 'pending' check (status in ('pending','retry','success','failed')),
  attempts integer not null default 0,
  rows_written integer not null default 0,
  amount numeric not null default 0,
  txn_count bigint not null default 0,
  last_error text null,
  last_sync_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (data_date, direction)
);

create index if not exists third_party_history_backfill_status_idx
  on public.third_party_history_backfill(status, data_date, direction);

alter table public.third_party_history_backfill enable row level security;

-- 历史补完后由 service_role 自动停止 10 分钟 Cron，避免长期空跑。
create or replace function public.stop_third_party_history_cron()
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'third-party-history-backfill'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;
revoke all on function public.stop_third_party_history_cron() from public, anon, authenticated;
grant execute on function public.stop_third_party_history_cron() to service_role;

-- 只生成历史月份；当前月由“今天 / 昨天”小时 Cron 持续更新。
insert into public.third_party_history_backfill (data_date, direction)
select d::date, x.direction
from generate_series(
  date '2026-04-01',
  (date_trunc('month', timezone('Asia/Manila', now()))::date - 1),
  interval '1 day'
) as d
cross join (values ('代收'::text), ('代付'::text)) as x(direction)
on conflict (data_date, direction) do nothing;

-- 避免重复建立同名任务；重复执行本 SQL 也不会叠加 Cron。
do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname in ('third-party-history-backfill', 'third-party-rates-auto')
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

-- 历史补齐：每 5 分钟最多补同方向连续 3 天；全部完成后 function 会自动停掉这个 Cron。
select cron.schedule(
  'third-party-history-backfill',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/bright-responder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'third_party_sync_secret'
        limit 1
      )
    ),
    body := '{"action":"sync-history-next"}'::jsonb
  );
  $$
);

-- 费率 / 盘口状态：每 6 小时自动更新一次；不需要每小时读取。
select cron.schedule(
  'third-party-rates-auto',
  '45 */6 * * *',
  $$
  select net.http_post(
    url := 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/bright-responder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'third_party_sync_secret'
        limit 1
      )
    ),
    body := '{"action":"sync-rates"}'::jsonb
  );
  $$
);

-- 最后检查：应新增 2 个 active=true 的任务。
select jobid, jobname, schedule, active
from cron.job
where jobname in ('third-party-history-backfill', 'third-party-rates-auto')
order by jobname;
