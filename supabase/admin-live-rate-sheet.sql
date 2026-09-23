-- Additive reader for the existing private rate-sheet snapshots.
-- Keep both the new preview grant and the original third_party + all-scope
-- permission. Never use a definer reader to bypass the original table RLS.
begin;

create function private.dashboard_admin_live_rate_sheet_access()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  -- This existing helper rechecks Auth, profile.active, independent preview
  -- grant and current data scope. It returns no source values to this caller.
  perform private.dashboard_admin_live_scope();
end;
$$;
revoke all on function private.dashboard_admin_live_rate_sheet_access() from public,anon;
grant execute on function private.dashboard_admin_live_rate_sheet_access() to authenticated;

create function private.dashboard_admin_live_rate_sheet(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_sheet_id bigint;
begin
  perform private.dashboard_admin_live_rate_sheet_access();
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or octet_length(p_request::text)>1024 or p_request-array['sheetId']<>'{}'::jsonb then
    raise exception using errcode='22023',message='invalid_rate_sheet_request';
  end if;
  if p_request ? 'sheetId' then
    if jsonb_typeof(p_request->'sheetId')<>'number'
      or p_request->>'sheetId' !~ '^(0|[1-9][0-9]{0,9})$' then
      raise exception using errcode='22023',message='invalid_rate_sheet_id';
    end if;
    v_sheet_id:=(p_request->>'sheetId')::bigint;
    if v_sheet_id>2147483647 then
      raise exception using errcode='22023',message='invalid_rate_sheet_id';
    end if;
  end if;
  -- SECURITY INVOKER deliberately preserves the original authenticated role:
  -- old permission checks, original RLS, published-generation selection and
  -- null-for-unavailable semantics all stay in the existing original reader.
  return public.dashboard_original_rate_sheet(p_sheet_id=>v_sheet_id);
end;
$$;
revoke all on function private.dashboard_admin_live_rate_sheet(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_rate_sheet(jsonb) to authenticated;

create function public.dashboard_admin_live_rate_sheet(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_rate_sheet(p_request);
$$;
revoke all on function public.dashboard_admin_live_rate_sheet(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_rate_sheet(jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
