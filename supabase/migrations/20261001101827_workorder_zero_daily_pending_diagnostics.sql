-- A received zero-deposit daily row may legitimately have no deposit states.
-- Explain only this diagnostic boundary; financial facts, completeness, source
-- rows, original identities, selected scopes and permissions remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $install$
declare
  target regprocedure:='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure;
  current_body text; candidate text; current_acl aclitem[]; owner_id oid;
  old_fragment constant text := $old$        case when coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理') ~ '^[0-9]{1,15}$'
          then coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理')::bigint$old$;
  new_fragment constant text := $new$        case when w.submitted_count is null or w.submitted_count<0 then null::bigint
        when w.submitted_count=0 then (
          -- WORKORDER_ZERO_DAILY_PENDING_DIAGNOSTICS_V4: zero is explicit in
          -- this received raw row, not inferred from a missing row or another
          -- channel. Empty state maps and valid withdrawal-only maps add no
          -- deposit pending records. Any deposit states must all be valid zeroes.
          select case when count(*)=0 or (
            bool_and(s.key=any(array['待处理','处理中','已驳回','已处理','系统处理中',
              '存款/待处理','存款/处理中','存款/已驳回','存款/已处理','存款/系统处理中',
              '提款/待处理','提款/处理中','提款/已驳回','提款/已处理','提款/系统处理中'])
              and coalesce(s.value ~ '^[0-9]{1,15}$',false)
              and case when s.value ~ '^[0-9]{1,15}$'
                then s.key like '提款/%' or s.value::bigint=0 else false end)
            and not (bool_or(s.key like '存款/%')
              and bool_or(s.key not like '存款/%' and s.key not like '提款/%'))
          ) then 0::bigint end
          from jsonb_each_text(w.status_counts) s
        )
        when coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理') ~ '^[0-9]{1,15}$'
          then coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理')::bigint$new$;
begin
  perform pg_advisory_xact_lock(hashtext('WORKORDER_KNOWN_PROVIDER_ATTRIBUTION_V1'));
  select prosrc,proacl,proowner into current_body,current_acl,owner_id from pg_proc where oid=target;
  if exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
    and (p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype or l.lanname<>'plpgsql'
      or p.proconfig is distinct from array['search_path=""']::text[])) then
    raise exception 'Original-order helper execution metadata changed; review before applying';
  end if;
  if exists(select 1 from aclexplode(coalesce(current_acl,acldefault('f',owner_id))) a
    where a.privilege_type='EXECUTE' and a.grantee<>owner_id) then
    raise exception 'Original-order helper ACL changed; review before applying';
  end if;
  if md5(current_body)='2e36e2f3d982a2a55d7f06e861f6dc3c' then return;end if;
  if md5(current_body)<>'bde8c3502c3d46a5838b80b0feb2e47f' then
    raise exception 'Original-order helper baseline changed; review before applying';
  end if;
  if (length(current_body)-length(replace(current_body,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'Zero daily pending diagnostic fragment changed; review before applying';
  end if;
  candidate:=replace(replace(current_body,old_fragment,new_fragment),'''diagnosticVersion'',3,','''diagnosticVersion'',4,');
  if md5(candidate)<>'2e36e2f3d982a2a55d7f06e861f6dc3c' then raise exception 'Zero daily pending diagnostic candidate changed';end if;
  execute 'create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='''' as '||quote_literal(candidate);
  if (select proacl is distinct from current_acl from pg_proc where oid=target) then
    raise exception 'Original-order helper ACL unexpectedly changed';
  end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
