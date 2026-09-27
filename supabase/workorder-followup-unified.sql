-- Run after admin-live-deposit-issues.sql. Private mirrors share a read model;
-- Google rows remain owned by the Google sync and can never be edited here.
begin;
grant usage on schema private to service_role;
create or replace function private.workorder_followup_outcome(p_value text)
returns text language sql immutable set search_path='' as $$
 select case lower(btrim(coalesce(p_value,'')))
 when 'success' then 'success' when '成功' then 'success'
 when 'success to other id' then 'other_id' when 'success to other platform' then 'other_platform'
 when 'success to other order' then 'other_order'
 when 'not yet received' then 'pending' when '尚未收到' then 'pending'
 when 'need to provide pdf/video' then 'need_evidence'
 when 'more than 30days/refund' then 'over30' when 'more than 15days refund' then 'over15'
 when 'no refund' then 'no_refund' when 'save upi / no refund' then 'no_refund' when 'refund' then 'refund'
 when 'save account contact appeal' then 'appeal' else 'unknown' end;
$$;
create or replace function private.workorder_followup_check(p_value text)
returns text language sql immutable set search_path='' as $$
 select case when lower(btrim(coalesce(p_value,''))) in ('yes','是','正确','一致','matched') then 'yes'
 when lower(btrim(coalesce(p_value,''))) in ('no','否','不正确','不一致','not matched') then 'no' else 'unknown' end;
$$;
revoke all on function private.workorder_followup_outcome(text),private.workorder_followup_check(text) from public,anon,authenticated;
grant execute on function private.workorder_followup_outcome(text),private.workorder_followup_check(text) to service_role;

create or replace function public.workorder_followup_list(p_account jsonb,p_filters jsonb default '{}',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
 if coalesce(p_account->>'role','') not in ('agent','supervisor','auditor') or p_account->>'active' is distinct from 'true'
 or coalesce(p_account->>'team','')='' or jsonb_typeof(p_account->'platforms') is distinct from 'array'
 or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or jsonb_typeof(p_filters) is distinct from 'object' then
 raise exception using errcode='22023',message='invalid_request'; end if;
 with scoped as materialized (
 select r.*,case when private.workorder_receipt_days(r.order_number) is not null then private.workorder_receipt_date(r.order_number) end as receipt_date,private.workorder_receipt_days(r.order_number) as days_since_order,case when upper(btrim(r.platform))='INDIA82' then '82LOTTERY' else r.platform end as display_platform,
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
 (coalesce(p_filters->>'source','all')='all' or r.source_kind=p_filters->>'source')
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
 and (coalesce(p_filters->>'from','')='' or r.followup_date >= (p_filters->>'from')::date)
 and (coalesce(p_filters->>'to','')='' or r.followup_date <= (p_filters->>'to')::date)
 and (coalesce(p_filters->>'minAmount','')='' or r.amount >= (p_filters->>'minAmount')::numeric)
 and (coalesce(p_filters->>'maxAmount','')='' or r.amount <= (p_filters->>'maxAmount')::numeric)
 ), page as (select * from filtered order by followup_date desc nulls last,source_row desc,id limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),
 'total',(select count(*) from filtered),'offset',p_offset,'limit',p_limit,
 'facets',jsonb_build_object(
 'platforms',p_account->'platforms',
 'providers',coalesce((select jsonb_agg(x.provider order by x.provider) from(select distinct provider from scoped where nullif(provider,'') is not null) x),'[]'::jsonb),
 'creators',coalesce((select jsonb_agg(x.first_actor order by x.first_actor) from(select distinct first_actor from scoped where nullif(first_actor,'') is not null) x),'[]'::jsonb),
 'followers',coalesce((select jsonb_agg(x.last_actor order by x.last_actor) from(select distinct last_actor from scoped where nullif(last_actor,'') is not null) x),'[]'::jsonb))) into v;
 return v;
end;
$$;
revoke all on function public.workorder_followup_list(jsonb,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.workorder_followup_list(jsonb,jsonb,integer,integer) to service_role;

create or replace function public.workorder_followup_mirror(p_record jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v public.admin_deposit_followup_rows; current_kind text;
begin
 v:=jsonb_populate_record(null::public.admin_deposit_followup_rows,p_record);
 if v.source_kind is distinct from 'portal' or v.source_sheet is distinct from 'PORTAL'
 or v.portal_case_id is null or v.portal_case_id !~ '^[a-f0-9-]{36}$'
 or v.id is distinct from 'PORTAL:'||v.portal_case_id or v.source_tab is distinct from v.portal_case_id
 or v.source_row is distinct from 1 or v.portal_version is null or v.portal_version<1
 or coalesce(v.portal_owner_id,'')='' or coalesce(v.portal_team,'')='' or v.country is distinct from '印度' then
 raise exception using errcode='22023',message='invalid_mirror'; end if;
 select r.source_kind into current_kind from public.admin_deposit_followup_rows r where r.id=v.id;
 if found and current_kind<>'portal' then raise exception using errcode='42501',message='history_read_only'; end if;
 insert into public.admin_deposit_followup_rows as target
 (id,source_sheet,source_tab,source_row,platform,country,order_number,work_order_number,utr,upi_id,kyc_upi_id,amount,provider,provider_reply,
 followup_status,utr_match,kyc_correct,evidence,followup_at,followup_date,receipt_text,source_updated_at,updated_at,
 source_kind,first_actor,last_actor,portal_case_id,portal_version,portal_owner_id,portal_team,portal_payload)
 values(v.id,v.source_sheet,v.source_tab,v.source_row,v.platform,v.country,v.order_number,v.work_order_number,v.utr,v.upi_id,v.kyc_upi_id,v.amount,v.provider,v.provider_reply,
 v.followup_status,v.utr_match,v.kyc_correct,v.evidence,v.followup_at,v.followup_date,v.receipt_text,v.source_updated_at,now(),
 v.source_kind,v.first_actor,v.last_actor,v.portal_case_id,v.portal_version,v.portal_owner_id,v.portal_team,v.portal_payload)
 on conflict(id) do update set order_number=excluded.order_number,work_order_number=excluded.work_order_number,utr=excluded.utr,upi_id=excluded.upi_id,kyc_upi_id=excluded.kyc_upi_id,amount=excluded.amount,
 provider=excluded.provider,provider_reply=excluded.provider_reply,followup_status=excluded.followup_status,utr_match=excluded.utr_match,
 kyc_correct=excluded.kyc_correct,evidence=excluded.evidence,followup_at=excluded.followup_at,followup_date=excluded.followup_date,receipt_text=excluded.receipt_text,
 source_updated_at=excluded.source_updated_at,updated_at=now(),last_actor=excluded.last_actor,portal_version=excluded.portal_version,
 portal_owner_id=excluded.portal_owner_id,portal_payload=excluded.portal_payload
 where target.source_kind='portal' and target.portal_version<excluded.portal_version;
 return true;
end;
$$;
revoke all on function public.workorder_followup_mirror(jsonb) from public,anon,authenticated;
grant execute on function public.workorder_followup_mirror(jsonb) to service_role;
commit;
