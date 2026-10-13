begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
declare mp record;before_meta jsonb;after_meta jsonb;
begin
 if current_user<>'postgres' then raise exception 'followup_patch_owner_required';end if;
 select p.*,pg_get_userbyid(p.proowner)owner_name,pg_get_function_arguments(p.oid)args,pg_get_function_result(p.oid)result into mp from pg_proc p where p.oid=to_regprocedure('public.workorder_followup_list(jsonb,jsonb,integer,integer)');
 if not found or md5(mp.prosrc) not in('b8d147e4ae4b72b31e697c6775e762aa','ebdc0eb1043b7e68db0170ca97ee1c88') or mp.owner_name<>'postgres' or mp.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 or mp.proconfig is distinct from array['search_path=""']::text[] or mp.prosecdef or mp.proisstrict or mp.proleakproof or mp.provolatile<>'s' or mp.proparallel<>'u'
 or mp.prolang<>(select oid from pg_language where lanname='plpgsql') or mp.result<>'jsonb' or mp.proretset or mp.procost<>100 or mp.prorows<>0 or mp.pronargdefaults<>3 or mp.provariadic<>0
 or mp.args is distinct from 'p_account jsonb, p_filters jsonb DEFAULT ''{}''::jsonb, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50' then raise exception 'followup_patch_metadata_drift';end if;
 if md5((select prosrc from pg_proc where oid=to_regprocedure('private.workorder_receipt_date(text)'))) is distinct from '7d9dfcd7036f11bf5dd257f4ea36e808' or md5((select prosrc from pg_proc where oid=to_regprocedure('private.workorder_receipt_days(text,timestamptz)'))) is distinct from 'bf9a6a283b1da2b39733e00ba7e46308' then raise exception 'followup_receipt_helpers_drift';end if;
 select to_jsonb(p)-'prosrc' into before_meta from pg_proc p where p.oid=mp.oid;
 if md5(mp.prosrc)='b8d147e4ae4b72b31e697c6775e762aa' then execute $definition$CREATE OR REPLACE FUNCTION public.workorder_followup_list(p_account jsonb, p_filters jsonb DEFAULT '{}'::jsonb, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
 if coalesce(p_account->>'role','') not in ('agent','supervisor','auditor') or p_account->>'active' is distinct from 'true'
 or coalesce(p_account->>'team','')='' or jsonb_typeof(p_account->'platforms') is distinct from 'array'
 or (p_filters ? 'view' and (jsonb_typeof(p_filters->'view') is distinct from 'string' or p_filters->>'view' not in ('all','pending')))
 or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or jsonb_typeof(p_filters) is distinct from 'object' then
 raise exception using errcode='22023',message='invalid_request'; end if;
 with scoped as materialized (
 select r.*,
 case when r.source_kind='portal' then coalesce(nullif(r.portal_payload->>'last_follow_at',''),nullif(r.portal_payload->>'created_at',''))::timestamptz end as portal_saved_at,
 case when r.source_kind='portal' then
   (coalesce(nullif(r.portal_payload->>'last_follow_at',''),nullif(r.portal_payload->>'created_at',''))::timestamptz at time zone 'Asia/Kolkata')::date
 else r.followup_date end as query_date,
 -- Only explicit completion statuses leave the pending queue. A success at a
 -- different ID/platform/order or a refund threshold still needs follow-up.
 not (lower(btrim(coalesce(case when r.source_kind='portal' then r.portal_payload->'entry'->>'outcome' end,r.followup_status,'')))
   in ('success','received','refunded','refund','closed','成功','成功到账','已到账','已入款','退款','已退款','已关闭')
   or r.source_kind='portal' and lower(btrim(coalesce(r.portal_payload->>'status','')))='closed') as followup_pending,
 case when upper(btrim(r.platform))='INDIA82' then '82LOTTERY' else r.platform end as display_platform,
 case when r.source_kind='portal' then coalesce(r.portal_payload->'entry'->>'outcome','unknown') else private.workorder_followup_outcome(r.followup_status) end as normalized_outcome,
 case when r.source_kind='portal' then coalesce(r.portal_payload->'entry'->>'kycCheck','unknown') else private.workorder_followup_check(r.kyc_correct) end as normalized_kyc,
 case when r.source_kind='portal' then coalesce(r.portal_payload->'entry'->>'utrMatch','unknown') else private.workorder_followup_check(r.utr_match) end as normalized_utr
 from public.admin_deposit_followup_rows r
 where r.stale_at is null and r.country='印度'
 and (p_account->'platforms') ? (case when upper(btrim(r.platform))='INDIA82' then '82LOTTERY' else r.platform end)
 and (r.source_kind='sheet' or r.source_kind='portal' and r.portal_team=p_account->>'team'
   and (p_account->>'role'<>'agent' or r.portal_owner_id=p_account->>'auth_user_id'))
 ), filtered as materialized (
 select * from scoped r where
 (coalesce(p_filters->>'view','all')='all' or r.followup_pending)
 and (coalesce(p_filters->>'source','all')='all' or r.source_kind=p_filters->>'source')
 and (coalesce(p_filters->>'platform','') in ('','all') or r.display_platform=p_filters->>'platform')
 and (coalesce(p_filters->>'provider','') in ('','all') or strpos(lower(coalesce(r.provider,'')),lower(p_filters->>'provider'))>0)
 and (coalesce(p_filters->>'creator','') in ('','all') or strpos(lower(coalesce(r.first_actor,'')),lower(p_filters->>'creator'))>0)
 and (coalesce(p_filters->>'follower','') in ('','all') or strpos(lower(coalesce(r.last_actor,'')),lower(p_filters->>'follower'))>0)
 and (coalesce(p_filters->>'outcome','') in ('','all') or r.normalized_outcome=p_filters->>'outcome')
 and (coalesce(p_filters->>'kyc','') in ('','all') or r.normalized_kyc=p_filters->>'kyc')
 and (coalesce(p_filters->>'utrMatch','') in ('','all') or r.normalized_utr=p_filters->>'utrMatch')
 and (coalesce(p_filters->>'orderNo','')='' or strpos(lower(coalesce(r.order_number,'')),lower(p_filters->>'orderNo'))>0)
 and (coalesce(p_filters->>'workorder','')='' or strpos(lower(coalesce(r.work_order_number,'')),lower(p_filters->>'workorder'))>0)
 and (coalesce(p_filters->>'utr','')='' or strpos(lower(coalesce(r.utr,'')),lower(p_filters->>'utr'))>0)
 and (coalesce(p_filters->>'reply','')='' or strpos(lower(coalesce(r.provider_reply,'')),lower(p_filters->>'reply'))>0)
 and (coalesce(p_filters->>'upiId','')='' or strpos(lower(coalesce(r.upi_id,'')),lower(p_filters->>'upiId'))>0)
 and (coalesce(p_filters->>'kycUpiId','')='' or strpos(lower(coalesce(r.kyc_upi_id,'')),lower(p_filters->>'kycUpiId'))>0)
 and (coalesce(p_filters->>'staffCode','')='' or strpos(lower(coalesce(r.staff_code,'')),lower(p_filters->>'staffCode'))>0)
 and (coalesce(p_filters->>'from','')='' or r.query_date >= (p_filters->>'from')::date)
 and (coalesce(p_filters->>'to','')='' or r.query_date <= (p_filters->>'to')::date)
 and (coalesce(p_filters->>'minAmount','')='' or r.amount >= (p_filters->>'minAmount')::numeric)
 and (coalesce(p_filters->>'maxAmount','')='' or r.amount <= (p_filters->>'maxAmount')::numeric)
 ), page_input as materialized (select * from filtered order by query_date desc nulls last,portal_saved_at desc nulls last,source_row desc,id limit p_limit offset p_offset),
 page as (
  -- Receipt ages decorate only the selected page, never filters or facets.
  select p.*,case when private.workorder_receipt_days(p.order_number) is not null then private.workorder_receipt_date(p.order_number) end as receipt_date,
   private.workorder_receipt_days(p.order_number) as days_since_order
  from page_input p
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.query_date desc nulls last,p.portal_saved_at desc nulls last,p.source_row desc,p.id) from page p),'[]'::jsonb),
 'total',(select count(*) from filtered),'offset',p_offset,'limit',p_limit,
 'facets',jsonb_build_object(
 'platforms',p_account->'platforms',
 'providers',coalesce((select jsonb_agg(x.provider order by x.provider) from(select distinct provider from scoped where nullif(provider,'') is not null) x),'[]'::jsonb),
 'creators',coalesce((select jsonb_agg(x.first_actor order by x.first_actor) from(select distinct first_actor from scoped where nullif(first_actor,'') is not null) x),'[]'::jsonb),
 'followers',coalesce((select jsonb_agg(x.last_actor order by x.last_actor) from(select distinct last_actor from scoped where nullif(last_actor,'') is not null) x),'[]'::jsonb))) into v;
 return v;
end;
$function$
;
$definition$;end if;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where p.oid=mp.oid;
 if before_meta is distinct from after_meta or md5((select prosrc from pg_proc where oid=mp.oid))<>'ebdc0eb1043b7e68db0170ca97ee1c88' then raise exception 'followup_patch_postcheck_failed';end if;
end;
$guard$;
commit;
