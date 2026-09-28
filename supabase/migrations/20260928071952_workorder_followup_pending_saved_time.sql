-- Unified all/pending follow-ups: scope, completion and dates apply before totals
-- and pagination. No due schedule, backend processing status or sync timestamp
-- is used to infer a completed payment or a human follow-up.
-- Prerequisite: workorder-followup-soft-archive.sql.
begin;
create or replace function public.workorder_followup_list(p_account jsonb,p_filters jsonb default '{}',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
 if coalesce(p_account->>'role','') not in ('agent','supervisor','auditor') or p_account->>'active' is distinct from 'true'
 or coalesce(p_account->>'team','')='' or jsonb_typeof(p_account->'platforms') is distinct from 'array'
 or (p_filters ? 'view' and (jsonb_typeof(p_filters->'view') is distinct from 'string' or p_filters->>'view' not in ('all','pending')))
 or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or jsonb_typeof(p_filters) is distinct from 'object' then
 raise exception using errcode='22023',message='invalid_request'; end if;
 with scoped as materialized (
 select r.*,
 case when r.source_kind='portal' then
   (coalesce(nullif(r.portal_payload->>'last_follow_at',''),nullif(r.portal_payload->>'created_at',''))::timestamptz at time zone 'Asia/Kolkata')::date
 else r.followup_date end as query_date,
 -- Only explicit completion statuses leave the pending queue. A success at a
 -- different ID/platform/order or a refund threshold still needs follow-up.
 not (lower(btrim(coalesce(case when r.source_kind='portal' then r.portal_payload->'entry'->>'outcome' end,r.followup_status,'')))
   in ('success','received','refunded','refund','closed','成功','成功到账','已到账','已入款','退款','已退款','已关闭')
   or r.source_kind='portal' and lower(btrim(coalesce(r.portal_payload->>'status','')))='closed') as followup_pending,
 case when private.workorder_receipt_days(r.order_number) is not null then private.workorder_receipt_date(r.order_number) end as receipt_date,private.workorder_receipt_days(r.order_number) as days_since_order,case when upper(btrim(r.platform))='INDIA82' then '82LOTTERY' else r.platform end as display_platform,
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
 ), page as (select * from filtered order by query_date desc nulls last,source_row desc,id limit p_limit offset p_offset)
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

 -- A deployment may add real follow-event metadata to an already mirrored
 -- version. Fill only missing metadata, and only when every business value
 -- still matches that exact version. Never synthesize a case save or advance
 -- the business version merely to repair its read model.
 update public.admin_deposit_followup_rows target set
  portal_payload=target.portal_payload || jsonb_build_object(
   'last_follow_at',v.portal_payload->'last_follow_at',
   'last_follow_actor_id',v.portal_payload->'last_follow_actor_id',
   'last_follow_actor_name',v.portal_payload->'last_follow_actor_name'),
  last_actor=v.last_actor,
  followup_date=((v.portal_payload->>'last_follow_at')::timestamptz at time zone 'Asia/Kolkata')::date
 where target.id=v.id and target.source_kind='portal' and target.portal_version=v.portal_version
  and nullif(btrim(target.portal_payload->>'last_follow_at'),'') is null
  and jsonb_typeof(v.portal_payload->'last_follow_at')='string'
  and nullif(btrim(v.portal_payload->>'last_follow_at'),'') is not null
  and (target.portal_payload-array['last_follow_at','last_follow_actor_id','last_follow_actor_name'])
    =(v.portal_payload-array['last_follow_at','last_follow_actor_id','last_follow_actor_name'])
  and row(target.country,target.platform,target.portal_case_id,target.portal_owner_id,target.portal_team,
    target.order_number,target.work_order_number,target.utr,target.upi_id,target.kyc_upi_id,target.amount,
    target.provider,target.provider_reply,target.followup_status,target.utr_match,target.kyc_correct,
    target.evidence,target.followup_at,target.receipt_text,target.source_updated_at,target.first_actor)
    is not distinct from
   row(v.country,v.platform,v.portal_case_id,v.portal_owner_id,v.portal_team,
    v.order_number,v.work_order_number,v.utr,v.upi_id,v.kyc_upi_id,v.amount,
    v.provider,v.provider_reply,v.followup_status,v.utr_match,v.kyc_correct,
    v.evidence,v.followup_at,v.receipt_text,v.source_updated_at,v.first_actor);
 return true;
end;
$$;
revoke all on function public.workorder_followup_mirror(jsonb) from public,anon,authenticated;
grant execute on function public.workorder_followup_mirror(jsonb) to service_role;

notify pgrst,'reload schema';
commit;
