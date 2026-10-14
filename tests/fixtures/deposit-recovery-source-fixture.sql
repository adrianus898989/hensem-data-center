-- Code-only dependencies, with no production row or account data.
create schema private;create role anon;create role authenticated;create role service_role bypassrls;
create table public.admin_deposit_followup_rows("id" text,"source_sheet" text,"source_tab" text,"source_gid" bigint,"source_row" integer,"platform" text,"country" text,"order_number" text,"work_order_number" text,"utr" text,"amount" numeric(24,2),"provider" text,"provider_reply" text,"followup_status" text,"utr_match" text,"kyc_correct" text,"evidence" text,"followup_at" text,"followup_date" date,"receipt_text" text,"source_updated_at" timestamp with time zone,"updated_at" timestamp with time zone,"source_kind" text,"first_actor" text,"last_actor" text,"portal_case_id" text,"portal_version" bigint,"portal_owner_id" text,"staff_code" text,"source_date_text" text,"portal_payload" jsonb,"portal_team" text,"upi_id" text,"kyc_upi_id" text,"stale_at" timestamp with time zone);
CREATE OR REPLACE FUNCTION private.workorder_receipt_date(p_order text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare value text:=upper(btrim(coalesce(p_order,''))); parsed date;
begin
 if value !~ '^RC[0-9]{8}' then return null; end if;
 begin parsed:=make_date(substring(value,3,4)::integer,substring(value,7,2)::integer,substring(value,9,2)::integer);
 exception when others then return null; end;
 return parsed;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.workorder_receipt_days(p_order text, p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when private.workorder_receipt_date(p_order)<=(p_now at time zone 'Asia/Kolkata')::date
 then (p_now at time zone 'Asia/Kolkata')::date-private.workorder_receipt_date(p_order) end;
$function$
;
create table if not exists public.admin_deposit_issue_rows (
  id text primary key,
  source_sheet text not null,
  source_tab text not null default 'UPI核对',
  source_row integer not null check (source_row > 0),
  platform text,
  country text,
  order_number text,
  utr text,
  amount numeric(24,2),
  provider text,
  match_status text,
  status text,
  unreceived_days integer,
  record_date date,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source_sheet, source_tab, source_row)
);

alter table public.admin_deposit_issue_rows add column if not exists provider_reply text;
alter table public.admin_deposit_issue_rows add column if not exists utr_match text;
alter table public.admin_deposit_issue_rows add column if not exists kyc_correct text;

create index if not exists admin_deposit_issue_rows_date_idx
  on public.admin_deposit_issue_rows(record_date desc, platform, provider, status);
create index if not exists admin_deposit_issue_rows_scope_idx
  on public.admin_deposit_issue_rows(country, platform, record_date desc);
create index if not exists admin_deposit_issue_rows_order_idx
  on public.admin_deposit_issue_rows(order_number, utr);

alter table public.admin_deposit_issue_rows enable row level security;
revoke all on public.admin_deposit_issue_rows from public, anon, authenticated;
grant all on public.admin_deposit_issue_rows to service_role;

-- Separate sources: input/follow-up rows must not be added to result totals.

CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_key(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case upper(btrim(p_name)) when 'DHANI.WIN' then 'DHANIWIN' when 'SHREE.WIN' then 'SHREEWIN'
 when 'VEER.GAME' then 'VEERGAME' when 'MAAN.WIN' then 'MAANWIN' else upper(btrim(p_name)) end;
$function$;
create or replace function private.dashboard_admin_live_deposit_platform_key(p_country text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_country in ('印度','IN','India') and upper(btrim(p_name))='INDIA82' then '82LOTTERY'
 else private.dashboard_admin_live_withdraw_key(p_name) end;
$$;

-- Explicit synthetic role/scope adapters; no JWT or production account claims.
create function private.dashboard_scope_allows(jsonb,text,text)returns boolean language sql immutable set search_path='' as $$select $2='IN'and($1->>'mode'='all'or coalesce($1->'platforms','[]'::jsonb)?$3)$$;
create function private.dashboard_admin_live_scope()returns jsonb language plpgsql stable set search_path='' as $$ begin if current_setting('test.denied',true)='true'then raise exception using errcode='42501',message='application_session_denied';end if;return coalesce(nullif(current_setting('test.scope',true),''),' {"mode":"all"}')::jsonb;end $$;
create function private.dashboard_role_access()returns jsonb language sql stable set search_path='' as $$select coalesce(nullif(current_setting('test.access',true),''),'{"mode":"owner"}')::jsonb$$;

alter table public.admin_deposit_issue_rows add column stale_at timestamptz,add column canonical_provider text,add column confirmation_status text,add column upi_id text,add column kyc_upi_id text;
