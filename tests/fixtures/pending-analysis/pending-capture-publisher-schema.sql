-- Offline production-shaped schemas. All rows/credentials are synthetic.
create schema private;
create schema extensions;
create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema private,extensions to service_role;
create function extensions.digest(v text,algorithm text) returns bytea language sql immutable
as $$select sha256(convert_to(v,'UTF8'))$$;
create function public.collection_success_safe_descriptor(v text,n integer) returns boolean language sql immutable
as $$select v is not null and length(v) between 1 and n and v!~'[[:cntrl:]]'$$;
create table public.withdraw_pending_credentials (
 token_hash text primary key,source_system text not null,allowed_scopes jsonb not null,
 expires_at timestamptz not null,revoked boolean not null default false,label text not null default '',created_at timestamptz default now());
create table public.withdraw_pending_snapshot_receipts (
 snapshot_id uuid primary key,payload_hash text not null,received_at timestamptz not null default now());
create table public.withdraw_pending_daily (
 source_system text not null,country_code text not null,platform text not null,stat_date date not null,
 snapshot_id uuid not null unique references public.withdraw_pending_snapshot_receipts(snapshot_id),snapshot_at timestamptz not null,
 snapshot jsonb not null,updated_at timestamptz not null default now(),primary key(source_system,country_code,platform,stat_date));
create table public.withdraw_pending_order_chunks (
 snapshot_id uuid not null,chunk_index integer not null,chunk_count integer not null,scope jsonb not null,orders jsonb not null,
 order_count integer not null,payload_bytes integer not null,chunk_hash text not null,created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,primary key(snapshot_id,chunk_index));
create table public.withdraw_pending_order_receipts (
 snapshot_id uuid primary key,scope jsonb not null,snapshot_hash text not null,details_hash text not null,chunk_hashes jsonb not null,
 chunk_count integer not null,order_count integer not null,created_at timestamptz not null default clock_timestamp());
create table public.withdraw_pending_orders (
 source_system text not null,country_code text not null,platform text not null,stat_date date not null,order_no text not null,member_id text not null,
 amount numeric(20,2) not null,applied_at timestamp not null,timezone text not null,raw_channel text not null,channel_type text not null,
 status text not null,snapshot_id uuid not null,snapshot_at timestamptz not null,updated_at timestamptz not null default clock_timestamp(),
 primary key(source_system,country_code,platform,stat_date,order_no));
create index withdraw_pending_orders_snapshot_idx on public.withdraw_pending_orders(snapshot_id);
create table public.withdraw_pending_backlog_sources (
 source_system text not null,country_code text not null,platform text not null,enabled_at timestamptz not null default clock_timestamp(),
 primary key(source_system,country_code,platform));
create table public.withdraw_pending_backlog_daily (
 source_system text not null,country_code text not null,platform text not null,stat_date date not null,capture_date date not null,
 window_start date not null,window_end date not null,snapshot_id uuid not null,snapshot_at timestamptz not null,snapshot jsonb not null,
 updated_at timestamptz not null default clock_timestamp(),primary key(source_system,country_code,platform,stat_date));
create table public.newar_detail_platforms (
 platform text primary key,country_code text not null,country text not null,timezone text not null,currency text not null,
 enabled boolean not null default true,launch_at timestamptz);
create table public.ar_config_targets (
 country_code text not null,platform text not null,country_name text not null,timezone text not null,currency text,
 source_system text not null default 'AR',primary key(country_code,platform));
create table public.dashboard_platform_team_map (
 id uuid primary key default gen_random_uuid(),team_name text not null,system_name text not null,source_system text not null,
 country_name text not null,country_code text not null,source_country text not null,platform_name text not null,source_platform text not null,
 active boolean not null default true,unique(source_system,source_country,source_platform));
create table private.collector_platform_identities (
 platform_id uuid primary key,mapping_id uuid not null unique,source_system text not null,source_country text not null,
 source_platform text not null,team_name text not null,country_code text not null,timezone text not null,currency text);
