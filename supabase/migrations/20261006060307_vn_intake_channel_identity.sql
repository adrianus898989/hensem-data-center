-- Reconcile the verified Vietnam collector aliases with creation-day order groups.
-- No business rows, snapshot values, authorization, OIDs, or reader ACLs are changed.
-- Raw snapshot duplicates and all completeness/count checks precede alias aggregation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 v_public record;v_private record;v_helper record;v_after record;
 v_public_metadata jsonb;v_private_metadata jsonb;
 v_auth oid;v_service oid;v_definition text;v_old text;v_new text;
 v_helper_body text:=$identity$
 select jsonb_build_array(
  case when p_country='VN' then
   case
    when p_channel='1VNPay-MoMo' and p_type in ('MoMoPay','MOMO QR') then '1VNPay'
    when p_channel='1VNPay-QR' and p_type='Quét mã ngân hàng' then '1VNPay'
    when p_channel='FastPay' and p_type='Chuyển khoản ngân hàng' then 'FASTPay'
    when p_channel='V8pay' and p_type='Chuyển khoản ngân hàng' then 'V8Pay'
    when p_channel='Shijie-QR' and p_type='Quét mã ngân hàng' then 'SHIJIE'
    when p_channel='YesPay-QR' and p_type='Quét mã ngân hàng' then 'YesPay'
    else p_channel
   end
  else p_channel end,
  case when p_country='VN' and p_channel in ('Tron-USDT','UniPayUSDT') and p_type='USDT-TRC20'
   then 'USDT' else p_type end
 )::text
$identity$;
 v_helper_hash constant text:='b5b2035a157093908a39f635ce3eae0d';
 v_before_hash constant text:='5816e612959fe8f9ffa0176140ac3b84';
 v_after_hash constant text:='d19ae8e97350488cf1bdd53c5520cf4c';
 v_helper_exists boolean;
begin
 select oid into v_auth from pg_roles where rolname='authenticated';
 select oid into v_service from pg_roles where rolname='service_role';
 select * into v_public from pg_proc where oid=to_regprocedure('public.dashboard_admin_live_intake_coverage(jsonb)');
 if not found or md5(v_public.prosrc)<>'697704eba7fc57c48dddfd78ec6043ff' or v_public.prosecdef
  or v_public.proretset or v_public.proisstrict or v_public.proleakproof or v_public.prokind<>'f'
  or v_public.prorettype<>'jsonb'::regtype or v_public.provolatile<>'s' or v_public.pronargdefaults<>1
  or v_public.proconfig is distinct from array['search_path=""']::text[]
  or v_public.prolang<>(select oid from pg_language where lanname='sql')
 then raise exception 'vn_intake_channel_public_drift';end if;
 if v_auth is null or exists(select 1 from aclexplode(coalesce(v_public.proacl,acldefault('f',v_public.proowner))) a
   where a.is_grantable or a.grantee not in(v_public.proowner,v_auth,coalesce(v_service,v_public.proowner)))
  or not exists(select 1 from aclexplode(v_public.proacl) a
   where a.grantee=v_auth and a.privilege_type='EXECUTE' and not a.is_grantable)
 then raise exception 'vn_intake_channel_public_acl_drift';end if;
 select * into v_private from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_intake_coverage(jsonb)');
 if not found or md5(v_private.prosrc) not in(v_before_hash,v_after_hash) or not v_private.prosecdef
  or v_private.proretset or v_private.proisstrict or v_private.proleakproof or v_private.prokind<>'f'
  or v_private.prorettype<>'jsonb'::regtype or v_private.provolatile<>'s' or v_private.pronargdefaults<>1
  or v_private.proconfig is distinct from array['search_path=""','jit=off']::text[]
  or v_private.prolang<>(select oid from pg_language where lanname='plpgsql')
  or v_private.proowner<>v_public.proowner
 then raise exception 'vn_intake_channel_private_drift';end if;
 if exists(select 1 from aclexplode(coalesce(v_private.proacl,acldefault('f',v_private.proowner))) a
   where a.is_grantable or a.grantee not in(v_private.proowner,v_auth))
  or not exists(select 1 from aclexplode(v_private.proacl) a
   where a.grantee=v_auth and a.privilege_type='EXECUTE' and not a.is_grantable)
 then raise exception 'vn_intake_channel_private_acl_drift';end if;
 v_public_metadata:=to_jsonb(v_public);v_private_metadata:=to_jsonb(v_private)-'prosrc';

 select * into v_helper from pg_proc where oid=to_regprocedure('private.dashboard_admin_vn_intake_channel_identity(text,text,text)');
 v_helper_exists:=found;
 if v_helper_exists then
  if md5(v_helper.prosrc)<>v_helper_hash or v_helper.prosecdef or v_helper.proisstrict
   or v_helper.proretset or v_helper.proleakproof or v_helper.prokind<>'f'
   or v_helper.proowner<>v_private.proowner or v_helper.prorettype<>'text'::regtype
   or v_helper.provolatile<>'i' or v_helper.proparallel<>'s' or v_helper.pronargdefaults<>0
   or v_helper.proconfig is distinct from array['search_path=""']::text[]
   or v_helper.proargnames is distinct from array['p_country','p_channel','p_type']::text[]
   or v_helper.prolang<>(select oid from pg_language where lanname='sql')
   or exists(select 1 from aclexplode(coalesce(v_helper.proacl,acldefault('f',v_helper.proowner))) a
    where a.is_grantable or a.grantee<>v_helper.proowner)
  then raise exception 'vn_intake_channel_identity_drift';end if;
 elsif md5(v_private.prosrc)=v_after_hash then
  raise exception 'vn_intake_channel_identity_missing';
 end if;
 -- Replay verifies both functions and helper before returning; it never silently repairs ACL drift.
 if md5(v_private.prosrc)=v_after_hash then return;end if;
 if not v_helper_exists then
  execute format('create function private.dashboard_admin_vn_intake_channel_identity(p_country text,p_channel text,p_type text)
   returns text language sql immutable security invoker parallel safe set search_path='''' as %L',v_helper_body);
  execute format('alter function private.dashboard_admin_vn_intake_channel_identity(text,text,text) owner to %I',
   pg_get_userbyid(v_private.proowner));
  revoke all on function private.dashboard_admin_vn_intake_channel_identity(text,text,text) from public,anon,authenticated,service_role;
 end if;

 v_old:=$old$        expected_count:=v_ar_counts[1]::bigint;collector_status:='snapshot_complete';
        -- Exact raw channel/type comparison: aliases must not hide a missing channel.
        -- No member/order fields or amounts leave this aggregate; status is deliberately irrelevant.
        select coalesce(sum(g.n),0)::bigint,coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb),max(g.seen)
         into fetched_count,v_ar_observed_groups,v_seen from(
          select jsonb_build_array(a.raw_channel,a.channel_type)::text key,count(*) n,max(a.updated_at) seen
          from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform
           and a.order_kind='recharge' and a.source_system='AR'
           and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp
          group by a.raw_channel,a.channel_type)g;$old$;
 v_new:=$new$        expected_count:=v_ar_counts[1]::bigint;collector_status:='snapshot_complete';
        -- VN_INTAKE_CHANNEL_IDENTITY_BEGIN
        -- Validate raw snapshot duplicates and totals above BEFORE combining verified VN aliases.
        -- Retain channel type, including separate bank QR and MoMo identities; unknown values stay raw.
        if v_raw_country='VN' then
         select coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb)
          into v_ar_expected_groups from(
           select private.dashboard_admin_vn_intake_channel_identity(v_raw_country,r->>'raw_channel',r->>'channel_type') key,
            sum((r->>'submitted_count')::numeric) n
           from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') r
           group by 1)g;
        end if;
        -- Count original groups first, then SUM canonical collisions; never let object aggregation overwrite them.
        -- No member/order fields or amounts leave this aggregate; status is deliberately irrelevant.
        select coalesce(sum(g.n),0)::bigint,coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb),max(g.seen)
         into fetched_count,v_ar_observed_groups,v_seen from(
          select private.dashboard_admin_vn_intake_channel_identity(v_raw_country,r.raw_channel,r.channel_type) key,
           sum(r.n) n,max(r.seen) seen from(
            select a.raw_channel,a.channel_type,count(*) n,max(a.updated_at) seen
            from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform
             and a.order_kind='recharge' and a.source_system='AR'
             and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp
            group by a.raw_channel,a.channel_type)r
          group by 1)g;
        -- VN_INTAKE_CHANNEL_IDENTITY_END$new$;
 v_definition:=pg_get_functiondef(v_private.oid);
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
  raise exception 'vn_intake_channel_patch_context_drift';end if;
 execute replace(v_definition,v_old,v_new);

 select * into v_after from pg_proc where oid=v_private.oid;
 if not found or md5(v_after.prosrc)<>v_after_hash or (to_jsonb(v_after)-'prosrc') is distinct from v_private_metadata
 then raise exception 'vn_intake_channel_private_postcheck_failed';end if;
 select * into v_after from pg_proc where oid=v_public.oid;
 if not found or to_jsonb(v_after) is distinct from v_public_metadata
 then raise exception 'vn_intake_channel_public_postcheck_failed';end if;
 select * into v_after from pg_proc where oid=to_regprocedure('private.dashboard_admin_vn_intake_channel_identity(text,text,text)');
 if not found or md5(v_after.prosrc)<>v_helper_hash or v_after.prosecdef or v_after.proisstrict
  or v_after.proretset or v_after.proleakproof or v_after.prokind<>'f'
  or v_after.proowner<>v_private.proowner or v_after.prorettype<>'text'::regtype
  or v_after.provolatile<>'i' or v_after.proparallel<>'s' or v_after.pronargdefaults<>0
  or v_after.proconfig is distinct from array['search_path=""']::text[]
  or v_after.proargnames is distinct from array['p_country','p_channel','p_type']::text[]
  or v_after.prolang<>(select oid from pg_language where lanname='sql')
  or exists(select 1 from aclexplode(coalesce(v_after.proacl,acldefault('f',v_after.proowner))) a
   where a.is_grantable or a.grantee<>v_after.proowner)
 then raise exception 'vn_intake_channel_identity_postcheck_failed';end if;
end;
$migration$;
commit;
