-- The existing daily notes only. No payout/order status is changed.
-- Same owner/admin + auto_withdraw entitlement and data scope as the legacy UI,
-- with a fresh detailed-admin grant check and an optimistic concurrency check.
begin;
create or replace function private.dashboard_admin_live_withdraw_note(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_date date;v_country text;v_platform text;v_query_country text;
 v_reason text;v_version text;v_key text;v_row public.auto_withdraw_notes%rowtype;v_data jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>8192
   or p_request-array['date','country','platform','reason','expectedVersion']<>'{}'::jsonb
   or not(p_request ?& array['date','country','platform','reason','expectedVersion']) then
   raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['date','country','platform','reason','expectedVersion'] loop
   if jsonb_typeof(p_request->v_key)<>'string' then raise exception using errcode='22023',message='invalid_request';end if;
 end loop;
 if not private.dashboard_admin_live_can_note() then raise exception using errcode='42501',message='note_denied';end if;
 if p_request->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or length(p_request->>'reason')>1000
   or p_request->>'expectedVersion' !~ '^([0-9a-f]{32})?$' then raise exception using errcode='22023',message='invalid_request';end if;
 v_date:=(p_request->>'date')::date;v_country:=btrim(p_request->>'country');v_platform:=btrim(p_request->>'platform');v_reason:=btrim(p_request->>'reason');
 if length(v_country) not between 1 and 100 or length(v_platform) not between 1 and 100
   or v_country||v_platform ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid_request';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 v_query_country:=private.dashboard_admin_live_report_country(v_country,v_platform);
 if upper(v_country) in ('巴西','BR','BRAZIL') and exists(select 1 from private.dashboard_admin_live_withdraw_platforms() p
   where p.country='胖虎巴西' and private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) then v_query_country:='胖虎巴西';end if;
 v_data:=private.dashboard_admin_live_auto_withdraw(jsonb_build_object('startAt',v_date||'T00:00:00Z',
   'endAt',v_date||'T23:59:59Z','country',v_query_country,'platform',v_platform));
 if coalesce((v_data->>'total')::integer,0)=0 then raise exception using errcode='22023',message='note_date_unavailable';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(jsonb_build_array(v_date,v_country,v_platform)::text,0));
 select * into v_row from public.auto_withdraw_notes n where n.data_date=v_date and n.country=v_country and n.platform=v_platform;
 v_version:=case when v_row.data_date is null then '' else md5(jsonb_build_array(extract(epoch from v_row.updated_at),v_row.reason)::text) end;
 if v_version<>p_request->>'expectedVersion' then raise exception using errcode='40001',message='note_conflict';end if;
 -- The existing stamp_auto_withdraw_note trigger continues to own author/time.
 insert into public.auto_withdraw_notes(data_date,country,platform,reason) values(v_date,v_country,v_platform,v_reason)
 on conflict(data_date,country,platform) do update set reason=excluded.reason returning * into v_row;
 return jsonb_build_object('date',v_row.data_date,'country',v_row.country,'platform',v_row.platform,'reason',v_row.reason,
   'updatedAt',v_row.updated_at,'version',md5(jsonb_build_array(extract(epoch from v_row.updated_at),v_row.reason)::text));
end;
$$;
revoke all on function private.dashboard_admin_live_withdraw_note(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_withdraw_note(jsonb) to authenticated;
create or replace function public.dashboard_admin_live_withdraw_note(p_request jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.dashboard_admin_live_withdraw_note(p_request)$$;
revoke all on function public.dashboard_admin_live_withdraw_note(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_withdraw_note(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
