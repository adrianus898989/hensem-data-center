-- Explicit synthetic registry, override and alias dependencies. The actual current
-- three-argument canonical function is installed separately, without auth claims.
create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,primary key(country,platform,raw_provider));
create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],primary key(country,platform,raw_provider));
create table private.synthetic_wg_aliases(country_code text,country text,platform text,raw_provider text,canonical_provider text);
create function private.dashboard_admin_wg_provider_aliases()returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text)language sql stable as $$select * from private.synthetic_wg_aliases$$;
create function private.dashboard_admin_live_confirmed_provider(text,text,text)returns text language sql immutable as $$select null::text$$;
create function private.dashboard_admin_live_provider_alias_values(text,text[])returns text[]language sql immutable as $$select $2$$;
create function private.dashboard_admin_live_provider_alias(text,text)returns text language sql immutable as $$select case when $1 in('印度','IN')then case btrim($2)when'UPI-QR2'then'ATPay'when'Phonepe_QR'then'UPI-QR'when'PAYTM-Super'then'SUPER'when'Super-QR'then'SUPER'else nullif(btrim($2),'')end else nullif(btrim($2),'')end$$;
revoke all on function private.dashboard_admin_live_provider_alias(text,text),private.dashboard_admin_wg_provider_aliases(),private.dashboard_admin_live_confirmed_provider(text,text,text),private.dashboard_admin_live_provider_alias_values(text,text[])from public,anon,authenticated,service_role;
