-- Explain sparse zero-count AR deposit states without changing financial facts,
-- completeness, original identity, selected scope, permissions or source data.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $install$
declare
  target regprocedure:='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure;
  current_body text; candidate text; current_acl aclitem[]; owner_id oid;
  old_fragment constant text := $old$      case when c.source='ar' and jsonb_typeof(w.status_counts)='object'
        and coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理') ~ '^[0-9]{1,15}$'
        then coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理')::bigint end as deposit_pending_count$old$;
  new_fragment constant text := $new$      case when c.source='ar' and jsonb_typeof(w.status_counts)='object' then
        case when coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理') ~ '^[0-9]{1,15}$'
          then coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理')::bigint
        -- WORKORDER_SPARSE_PENDING_DIAGNOSTICS_V3: collectors omit zero-count states.
        -- Prove an omitted pending key is zero only from an entire valid deposit
        -- state map matching this raw daily row's submitted count. Never infer it
        -- from another channel, a withdrawal prefix, an empty map or malformed keys.
        when not (w.status_counts ?| array['存款/待处理','待处理']) then (
          select case when count(*)>0
            and bool_and(s.key=any(array['处理中','已驳回','已处理','系统处理中',
              '存款/处理中','存款/已驳回','存款/已处理','存款/系统处理中'])
              and coalesce(s.value ~ '^[0-9]{1,15}$',false))
            -- Mixed legacy/plain and prefixed deposit maps could double-count a
            -- state. Keep them unknown rather than accepting a coincidental sum.
            and not (bool_or(s.key like '存款/%') and bool_or(s.key not like '存款/%'))
            and sum(case when s.value ~ '^[0-9]{1,15}$' then s.value::bigint end)=w.submitted_count
            then 0::bigint end
          from jsonb_each_text(w.status_counts) s
          where s.key not like '提款/%'
        ) end
      end as deposit_pending_count$new$;
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
  if md5(current_body)='bde8c3502c3d46a5838b80b0feb2e47f' then return;end if;
  if md5(current_body)<>'8df973457d5175aa0b876a5556168599' then
    raise exception 'Original-order helper baseline changed; review before applying';
  end if;
  if (length(current_body)-length(replace(current_body,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'Sparse pending diagnostic fragment changed; review before applying';
  end if;
  candidate:=replace(replace(current_body,old_fragment,new_fragment),'''diagnosticVersion'',2,','''diagnosticVersion'',3,');
  if md5(candidate)<>'bde8c3502c3d46a5838b80b0feb2e47f' then raise exception 'Sparse pending diagnostic candidate changed';end if;
  execute 'create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='''' as '||quote_literal(candidate);
  if (select proacl is distinct from current_acl from pg_proc where oid=target) then
    raise exception 'Original-order helper ACL unexpectedly changed';
  end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
