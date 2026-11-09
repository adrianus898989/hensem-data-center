-- Deterministic stand-ins for the existing session, catalog and scope contracts.
-- The candidate supplies the real merger, reader, projection and public dispatcher.
create role anon;
create role authenticated;
create role service_role;
create schema private;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.ticket_test_catalog(
  id uuid, name text, team text, country text, scope_group text,
  source text, timezone text, currency text, source_name text
);
create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='session_denied';end if;
 return current_setting('test.scope')::jsonb;
end;$$;
create function private.dashboard_role_access() returns jsonb language sql stable as
$$select current_setting('test.access')::jsonb$$;
create function private.dashboard_scope_allows(scope jsonb,country text,platform text)
returns boolean language sql stable as $$select (scope->country) ? platform$$;
create function private.dashboard_admin_live_platforms() returns setof public.ticket_test_catalog language sql stable as
$$select * from public.ticket_test_catalog$$;
create function private.dashboard_admin_live_workorder_analysis(jsonb) returns jsonb language sql as
$$select '{"oldView":"orders"}'::jsonb$$;
create function private.dashboard_admin_live_workorder_records(jsonb) returns jsonb language sql as
$$select '{"oldView":"records"}'::jsonb$$;
create function public.dashboard_admin_live_workorder_records(p_request jsonb) returns jsonb language sql as $$
select case when p_request->>'view'='orders' or p_request->>'operation' in ('summary','orderDetail')
 then private.dashboard_admin_live_workorder_analysis(p_request)
 else private.dashboard_admin_live_workorder_records(p_request) end;
$$;
create function public.dashboard_admin_execute(p_page text,p_request jsonb) returns jsonb language plpgsql as $$
declare v_view text:=p_request->>'view';
begin
 if p_page='workorders' and coalesce(v_view,'records') in ('records','orders') then
   return public.dashboard_admin_live_workorder_records(p_request);
 end if;
 raise exception using errcode='42501',message='unknown_view';
end;$$;
grant usage on schema auth,private to anon,authenticated,service_role;
revoke all on function public.dashboard_admin_execute(text,jsonb) from public,anon,service_role;
grant execute on function public.dashboard_admin_execute(text,jsonb) to authenticated;
revoke all on function public.dashboard_admin_live_workorder_records(jsonb) from public, anon;
grant execute on function public.dashboard_admin_live_workorder_records(jsonb) to authenticated, service_role;
