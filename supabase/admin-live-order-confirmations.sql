-- Private, exact-order confirmations. Source orders and collectors stay unchanged.
-- Real order confirmations are installed separately, never committed as fixtures.
begin;
create table if not exists private.dashboard_admin_order_provider_confirmations (
  source_system text not null,
  country_code text not null,
  platform text not null,
  order_kind text not null check (order_kind in ('recharge','withdraw')),
  order_no text not null,
  confirmed_provider text not null check (length(btrim(confirmed_provider)) between 1 and 200),
  confirmation_note text not null,
  confirmed_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (source_system,country_code,platform,order_kind,order_no)
);
alter table private.dashboard_admin_order_provider_confirmations enable row level security;
revoke all on table private.dashboard_admin_order_provider_confirmations from public,anon,authenticated;
commit;
