-- Preserve a proven RC deposit reference when a later untyped source response
-- omits all original-number fields. Only the workorder conflict-update changes.
-- No scan/backfill, new grants, helper functions, or new raw-input permissions.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $install$
declare
 target regprocedure:='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure;
 wrapper regprocedure:='public.ingest_newar_detail_batch(text,jsonb)'::regprocedure;
 before_meta jsonb;after_meta jsonb;wrapper_meta jsonb;current_body text;candidate text;restored text;
 marker constant text:=E'-- NEWAR_WORKORDER_ORIGINAL_PRESERVE_V1\n';
 old_original text;keep_condition text;order_assignment text;raw_assignment text;
begin
 select to_jsonb(p)-'prosrc',p.prosrc into before_meta,current_body from pg_proc p where p.oid=target;
 select to_jsonb(p) into wrapper_meta from pg_proc p where p.oid=wrapper;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and l.lanname='plpgsql' and p.prokind='f' and p.prorettype='jsonb'::regtype and not p.proretset
   and p.proargnames=array['p_token_hash','p_batch'] and p.prosecdef and p.provolatile='v'
   and p.proconfig=array['search_path=""']::text[])
 then raise exception 'NEWAR_ORIGINAL_GUARD_SIGNATURE_CHANGED';end if;
 if has_function_privilege('anon',target,'execute') or has_function_privilege('authenticated',target,'execute')
   or not has_function_privilege('service_role',target,'execute')
   or has_function_privilege('anon',wrapper,'execute') or has_function_privilege('authenticated',wrapper,'execute')
   or not has_function_privilege('service_role',wrapper,'execute')
 then raise exception 'NEWAR_ORIGINAL_GUARD_ACL_CHANGED';end if;

 old_original:=$expression$coalesce(
      case when jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'depositOrderNo' end,
      case when jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'rechargeNumber' end)$expression$;
 keep_condition:=$condition$(old.dataset='workorder' and excluded.dataset='workorder'
      and nullif(btrim(excluded.order_number),'') is null
      and (excluded.raw->'depositOrderNo' is null or excluded.raw->'depositOrderNo'='null'::jsonb
        or jsonb_typeof(excluded.raw->'depositOrderNo')='string' and nullif(btrim(excluded.raw->>'depositOrderNo'),'') is null)
      and (excluded.raw->'rechargeNumber' is null or excluded.raw->'rechargeNumber'='null'::jsonb
        or jsonb_typeof(excluded.raw->'rechargeNumber')='string' and nullif(btrim(excluded.raw->>'rechargeNumber'),'') is null)
      and not (coalesce(jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$',false)
        and coalesce(jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$',false)
        and old.raw->>'depositOrderNo'<>old.raw->>'rechargeNumber')
      and $condition$||old_original||' is not null)';
 order_assignment:='order_number=case when '||keep_condition||' then '||old_original||' else excluded.order_number end';
 raw_assignment:='raw=case when '||keep_condition||$expression$ then excluded.raw
      ||coalesce((select jsonb_object_agg(k.key,k.value) from jsonb_each(old.raw) k
        where k.key in ('depositOrderNo','rechargeNumber') and jsonb_typeof(k.value)='string' and (k.value#>>'{}') ~ '^RC[A-Za-z0-9_-]{1,198}$'),'{}'::jsonb)
      ||case when jsonb_typeof(old.raw->'_depositOriginalBackfill')='object'
        and old.raw#>>'{_depositOriginalBackfill,source}'='typed-workorder-original-backfill'
        and old.raw#>>'{_depositOriginalBackfill,workOrderId}'=old.source_id
        and old.raw#>>'{_depositOriginalBackfill,depositOrderNo}'=$expression$||old_original||$expression$
        then jsonb_build_object('_depositOriginalBackfill',old.raw->'_depositOriginalBackfill') else '{}'::jsonb end
      else excluded.raw end$expression$;

 if left(current_body,length(marker))=marker then
   restored:=replace(replace(substr(current_body,length(marker)+1),order_assignment,'order_number=excluded.order_number'),raw_assignment,'raw=excluded.raw');
   if md5(restored)<>'54aed8735613fd85ec572e6d3561b2fb' then raise exception 'NEWAR_ORIGINAL_GUARD_PATCH_DRIFT';end if;
   candidate:=current_body;
 else
   if md5(current_body)<>'54aed8735613fd85ec572e6d3561b2fb' then raise exception 'NEWAR_ORIGINAL_GUARD_SOURCE_DRIFT';end if;
   candidate:=marker||replace(replace(current_body,'order_number=excluded.order_number',order_assignment),'raw=excluded.raw',raw_assignment);
 end if;
 if candidate<>current_body then
   execute format('create or replace function private.ingest_newar_detail_batch(p_token_hash text,p_batch jsonb) returns jsonb language plpgsql security definer set search_path='''' as %L',candidate);
 end if;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where p.oid=target;
 if after_meta is distinct from before_meta or (select to_jsonb(p) from pg_proc p where p.oid=wrapper) is distinct from wrapper_meta
 then raise exception 'NEWAR_ORIGINAL_GUARD_SECURITY_OR_SIGNATURE_CHANGED';end if;
 if (select prosrc from pg_proc where oid=target) is distinct from candidate then raise exception 'NEWAR_ORIGINAL_GUARD_BODY_MISMATCH';end if;
end
$install$;
commit;
