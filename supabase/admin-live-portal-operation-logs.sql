-- Authorize D1 workorder-event platform pairs using the current dashboard
-- profile and source scopes. This RPC reads no event/customer data and writes
-- no permissions. The portal still applies these pairs to every D1 query.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function private.dashboard_admin_live_portal_log_scope(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='10s' as $$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_candidates jsonb;v_row jsonb;v_result jsonb;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or p_request-array['country','candidates']<>'{}'::jsonb
  or coalesce(p_request->>'country','') not in ('IN','印度') or jsonb_typeof(p_request->'country') is distinct from 'string'
  or octet_length(p_request::text)>200000 then raise exception using errcode='22023',message='invalid_request';end if;
 v_candidates:=p_request->'candidates';
 if jsonb_typeof(v_candidates) is distinct from 'array' or jsonb_array_length(v_candidates)>1000 then raise exception using errcode='22023',message='invalid_candidates';end if;
 for v_row in select value from jsonb_array_elements(v_candidates) loop
  if jsonb_typeof(v_row) is distinct from 'object' or v_row-array['team','platform']<>'{}'::jsonb
   or jsonb_typeof(v_row->'team') is distinct from 'string' or jsonb_typeof(v_row->'platform') is distinct from 'string'
   or coalesce(v_row->>'team','')='' or length(v_row->>'team')>80 or v_row->>'team'<>btrim(v_row->>'team') or v_row->>'team' ~ '[[:cntrl:]]'
   or coalesce(v_row->>'platform','')='' or length(v_row->>'platform')>160 or v_row->>'platform'<>btrim(v_row->>'platform') or v_row->>'platform' ~ '[[:cntrl:]]'
  then raise exception using errcode='22023',message='invalid_candidate';end if;
 end loop;
 with candidates as (select distinct value->>'team' team,value->>'platform' platform from jsonb_array_elements(v_candidates)),
 catalog as materialized (select p.* from private.dashboard_admin_live_platforms() p
  where p.scope_group in ('IN','HK_TEAM','RED_CRAB') and private.dashboard_scope_allows(v_scope,p.scope_group,p.source_name)),
 allowed as (select distinct c.team,c.platform from candidates c where exists(
  select 1 from catalog p where p.team=c.team and (c.platform=p.name or c.platform=p.source_name
   or p.team='M8' and p.scope_group='IN' and lower(p.source)='ar' and p.source_name in ('RAJA','RAJALOTTERY') and c.platform in ('RAJA','RAJALOTTERY'))))
 select coalesce(jsonb_agg(jsonb_build_object('team',team,'platform',platform) order by team,platform),'[]'::jsonb) into v_result from allowed;
 return jsonb_build_object('ok',true,'country','印度','pairs',v_result);
end;$$;
revoke all on function private.dashboard_admin_live_portal_log_scope(jsonb) from public,anon,authenticated;
create or replace function public.dashboard_admin_live_portal_log_scope(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.dashboard_admin_live_portal_log_scope(p_request); $$;
revoke all on function public.dashboard_admin_live_portal_log_scope(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_portal_log_scope(jsonb) to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.dashboard_admin_live_portal_log_scope(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
