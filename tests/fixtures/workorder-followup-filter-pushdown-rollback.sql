-- Push literal substring filters ahead of row decoration. Keep all-history
-- facets narrow, with unchanged account scope, status, date and paging semantics.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';
do $install$
declare p record;original jsonb;
begin
 select f.* into p from pg_proc f where f.oid='public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure;
 if current_user<>'postgres' or p.proowner<>'postgres'::regrole or p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  or md5(p.prosrc) not in ('752955ecd52ddb56774e52524bf0c51c','ebdc0eb1043b7e68db0170ca97ee1c88') then raise exception 'followup_search_definition_drift';end if;
 if md5(p.prosrc)='ebdc0eb1043b7e68db0170ca97ee1c88' then return;end if;
 original:=to_jsonb(p)-'prosrc';
 execute $definition$CREATE OR REPLACE FUNCTION public.workorder_followup_list(p_account jsonb, p_filters jsonb DEFAULT '{}'::jsonb, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
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
$definition$;
 select f.* into p from pg_proc f where f.oid='public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure;
 if md5(p.prosrc)<>'ebdc0eb1043b7e68db0170ca97ee1c88' or (to_jsonb(p)-'prosrc')is distinct from original then raise exception 'followup_search_postcondition_drift';end if;
end;$install$;
commit;
