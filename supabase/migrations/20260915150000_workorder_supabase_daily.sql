begin;

-- AR 工单脚本直接写入的日汇总。Google Sheet 可以继续作为历史/核对来源，
-- 但新数据由采集脚本直接 upsert 到这两张表，前端不需要等待 Google API。
create table public.workorder_daily_bundle (
  system_name text not null check (system_name = 'AR'),
  stat_date date not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  country text not null,
  platform text not null,
  daily_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(daily_rows) = 'array'),
  type_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(type_rows) = 'array'),
  employee_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(employee_rows) = 'array'),
  source_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (system_name, stat_date, country_code, platform)
);
create index workorder_daily_bundle_date_idx on public.workorder_daily_bundle (stat_date, country_code, platform);

-- “存款未到账”只保留可展示的聚合结果，提交包含所有状态，成功严格为“已处理”。
create table public.workorder_deposit_daily (
  system_name text not null check (system_name = 'AR'),
  source_system text not null check (source_system = 'AR_WORKORDER'),
  stat_date date not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  country text not null,
  platform text not null,
  third_party text not null,
  channel_type text not null,
  submitted_count bigint not null check (submitted_count >= 0),
  submitted_amount numeric(24,2) not null check (submitted_amount >= 0),
  success_count bigint not null check (success_count >= 0 and success_count <= submitted_count),
  success_amount numeric(24,2) not null check (success_amount >= 0 and success_amount <= submitted_amount),
  status_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(status_counts) = 'object'),
  source_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (system_name, stat_date, country_code, platform, third_party, channel_type)
);
create index workorder_deposit_daily_date_idx on public.workorder_deposit_daily (stat_date, country_code, platform, third_party);

alter table public.workorder_daily_bundle enable row level security;
alter table public.workorder_deposit_daily enable row level security;
revoke all on public.workorder_daily_bundle, public.workorder_deposit_daily from public, anon, authenticated;
grant select, insert, update on public.workorder_daily_bundle to service_role;
grant select, insert, update on public.workorder_deposit_daily to service_role;
grant select on public.workorder_daily_bundle, public.workorder_deposit_daily to authenticated;

create policy workorder_bundle_read on public.workorder_daily_bundle for select to authenticated
  using (
    (select public.dashboard_has_permission('work_orders'))
    and private.dashboard_scope_allows((select private.dashboard_current_data_scope()), country_code, platform)
  );

create policy workorder_deposit_read on public.workorder_deposit_daily for select to authenticated
  using (
    ((select public.dashboard_has_permission('third_party')) or (select public.dashboard_has_permission('work_orders')))
    and private.dashboard_scope_allows((select private.dashboard_current_data_scope()), country_code, platform)
  );

commit;
