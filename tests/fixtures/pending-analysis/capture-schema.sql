-- Schema contract only. These tables will be created by the reviewed migration.
create table private.withdraw_pending_capture_archive (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  country_code text not null,
  platform text not null,
  stat_date date not null,
  capture_date date not null,
  window_start date not null,
  window_end date not null,
  window_days integer not null,
  snapshot_id uuid not null,
  snapshot_at timestamptz not null,
  snapshot jsonb not null,
  timezone text not null,
  capture_basis text not null default 'actual_capture',
  within_midnight_window boolean not null,
  identity_status text not null check(identity_status in ('resolved','legacy_unbound')),
  native_source_system text check(native_source_system in ('AR','NEW_AR')),
  platform_id uuid,
  team_name text,
  currency text,
  partition_snapshots jsonb not null,
  pending_count bigint not null,
  pending_amount numeric not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique(source_system,country_code,platform,snapshot_at,window_start,window_end)
);
create table private.withdraw_pending_capture_orders (
  archive_id uuid not null references private.withdraw_pending_capture_archive(id),
  order_no text not null,
  source_system text not null,
  country_code text not null,
  platform text not null,
  stat_date date not null,
  amount numeric not null,
  applied_at timestamp,
  timezone text not null,
  raw_channel text not null,
  channel_type text not null,
  status text not null,
  snapshot_id uuid not null,
  snapshot_at timestamptz not null,
  primary key(archive_id,order_no)
);

alter table private.withdraw_pending_capture_archive enable row level security;
alter table private.withdraw_pending_capture_orders enable row level security;
