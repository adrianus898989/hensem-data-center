create table private.ar_middle_channel_platforms (
  country_code text, dashboard_platform_id uuid, native_platform text, source_tenant_id text, enabled boolean
);
-- Tests separately control the scope grant on each source name.
create function private.dashboard_scope_platform_identity(country text,platform text) returns text language sql immutable as $$
 select case when country='IN' and platform in ('OKWIN','OK.WIN') then 'OKWIN' else platform end
$$;
