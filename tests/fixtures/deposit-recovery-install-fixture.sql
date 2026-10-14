-- Synthetic, empty installation dependencies. Exact reviewed schema/function code; no production data.
create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
create table public.dashboard_profiles(auth_user_id uuid,active boolean,role text);
create table private.dashboard_role_assignments(auth_user_id uuid,role_id uuid,version bigint);
create table private.dashboard_roles(id uuid,active boolean,permissions text[],name text,version bigint);
create table public.newar_detail_platforms("platform" text not null,"country_code" text not null,"country" text not null,"timezone" text not null,"currency" text not null,"enabled" boolean not null,"launch_at" timestamp with time zone);
alter table public.newar_detail_platforms add constraint "newar_detail_platforms_country_code_check" CHECK ((country_code ~ '^[A-Z]{2}$'::text));
alter table public.newar_detail_platforms add constraint "newar_detail_platforms_pkey" PRIMARY KEY (platform);
alter table public.newar_detail_platforms enable row level security;
revoke all on public.newar_detail_platforms from public,anon,authenticated,service_role;grant all on public.newar_detail_platforms to service_role;
create table public.newar_detail_records("id" uuid not null,"platform" text not null,"dataset" text not null,"source_id" text not null,"member_id" text,"order_number" text,"third_party_order_number" text,"provider" text,"provider_id" text,"channel_type" text,"currency" text,"amount" numeric(24,8) not null,"actual_amount" numeric(24,8),"fee" numeric(24,8),"status_code" text,"status_group" text not null,"created_at" timestamp with time zone not null,"success_at" timestamp with time zone,"processed_at" timestamp with time zone,"source_updated_at" timestamp with time zone,"captured_at" timestamp with time zone not null,"workorder_type" text,"operator" text,"followup_count" integer,"raw" jsonb not null,"received_at" timestamp with time zone not null);
alter table public.newar_detail_records add constraint "newar_detail_records_actual_amount_check" CHECK (((actual_amount >= (0)::numeric) AND ((actual_amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))));
alter table public.newar_detail_records add constraint "newar_detail_records_amount_check" CHECK (((amount >= (0)::numeric) AND ((amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))));
alter table public.newar_detail_records add constraint "newar_detail_records_check" CHECK (((success_at IS NULL) OR ((status_group = 'success'::text) AND (success_at >= created_at))));
alter table public.newar_detail_records add constraint "newar_detail_records_check1" CHECK (((processed_at IS NULL) OR (processed_at >= created_at)));
alter table public.newar_detail_records add constraint "newar_detail_records_currency_check" CHECK (((currency IS NULL) OR (currency ~ '^[A-Z0-9]{3,8}$'::text)));
alter table public.newar_detail_records add constraint "newar_detail_records_dataset_check" CHECK ((dataset = ANY (ARRAY['charge'::text, 'withdraw'::text, 'workorder'::text])));
alter table public.newar_detail_records add constraint "newar_detail_records_fee_check" CHECK (((fee >= (0)::numeric) AND ((fee)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))));
alter table public.newar_detail_records add constraint "newar_detail_records_followup_count_check" CHECK ((followup_count >= 0));
alter table public.newar_detail_records add constraint "newar_detail_records_pkey" PRIMARY KEY (id);
alter table public.newar_detail_records add constraint "newar_detail_records_platform_dataset_source_id_key" UNIQUE (platform, dataset, source_id);
alter table public.newar_detail_records add constraint "newar_detail_records_platform_fkey" FOREIGN KEY (platform) REFERENCES newar_detail_platforms(platform);
alter table public.newar_detail_records add constraint "newar_detail_records_raw_check" CHECK ((jsonb_typeof(raw) = 'object'::text));
alter table public.newar_detail_records add constraint "newar_detail_records_source_id_check" CHECK (((length(source_id) >= 1) AND (length(source_id) <= 200)));
alter table public.newar_detail_records add constraint "newar_detail_records_status_group_check" CHECK ((status_group = ANY (ARRAY['success'::text, 'pending'::text, 'failed'::text, 'rejected'::text, 'unknown'::text])));
CREATE INDEX newar_detail_business_cover_idx ON public.newar_detail_records USING btree (platform, dataset, created_at) INCLUDE (status_group, amount, currency, provider, channel_type, captured_at, received_at);
CREATE INDEX newar_detail_created_idx ON public.newar_detail_records USING btree (platform, dataset, created_at DESC, id DESC);
CREATE INDEX newar_detail_member_idx ON public.newar_detail_records USING btree (platform, dataset, member_id, created_at DESC, id DESC) WHERE (member_id IS NOT NULL);
CREATE INDEX newar_detail_order_idx ON public.newar_detail_records USING btree (platform, dataset, order_number) WHERE (order_number IS NOT NULL);
CREATE INDEX newar_detail_processed_idx ON public.newar_detail_records USING btree (platform, dataset, processed_at DESC, id DESC) WHERE (processed_at IS NOT NULL);
CREATE INDEX newar_detail_success_idx ON public.newar_detail_records USING btree (platform, dataset, success_at DESC, id DESC) WHERE ((status_group = 'success'::text) AND (success_at IS NOT NULL));
CREATE INDEX newar_detail_third_order_idx ON public.newar_detail_records USING btree (platform, dataset, third_party_order_number) WHERE (third_party_order_number IS NOT NULL);
CREATE INDEX newar_member_two_created_cover_idx ON public.newar_detail_records USING btree (platform, dataset, created_at) INCLUDE (member_id, currency) WHERE ((platform = ANY (ARRAY['MAANWIN'::text, 'DhaniWin'::text])) AND (dataset = ANY (ARRAY['charge'::text, 'withdraw'::text])));
CREATE INDEX newar_member_two_success_cover_idx ON public.newar_detail_records USING btree (platform, dataset, success_at) INCLUDE (member_id, currency, created_at) WHERE ((platform = ANY (ARRAY['MAANWIN'::text, 'DhaniWin'::text])) AND (dataset = ANY (ARRAY['charge'::text, 'withdraw'::text])) AND (status_group = 'success'::text) AND (success_at IS NOT NULL));
CREATE INDEX newar_workorder_deposit_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'depositOrderNo'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'depositOrderNo'::text)) = 'string'::text));
CREATE INDEX newar_workorder_recharge_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'rechargeNumber'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'rechargeNumber'::text)) = 'string'::text));
alter table public.newar_detail_records enable row level security;
revoke all on public.newar_detail_records from public,anon,authenticated,service_role;grant all on public.newar_detail_records to service_role;
create table public.admin_deposit_issue_rows("id" text not null,"source_sheet" text not null,"source_tab" text not null,"source_row" integer not null,"platform" text,"country" text,"order_number" text,"utr" text,"amount" numeric(24,2),"provider" text,"match_status" text,"status" text,"unreceived_days" integer,"record_date" date,"source_updated_at" timestamp with time zone,"updated_at" timestamp with time zone not null,"provider_reply" text,"utr_match" text,"kyc_correct" text,"upi_id" text,"kyc_upi_id" text,"stale_at" timestamp with time zone,"canonical_provider" text,"confirmation_status" text);
alter table public.admin_deposit_issue_rows add constraint "admin_deposit_issue_rows_pkey" PRIMARY KEY (id);
alter table public.admin_deposit_issue_rows add constraint "admin_deposit_issue_rows_source_row_check" CHECK ((source_row > 0));
alter table public.admin_deposit_issue_rows add constraint "admin_deposit_issue_rows_source_sheet_source_tab_source_row_key" UNIQUE (source_sheet, source_tab, source_row);
CREATE INDEX admin_deposit_issue_rows_date_idx ON public.admin_deposit_issue_rows USING btree (record_date DESC, platform, provider, status);
CREATE INDEX admin_deposit_issue_rows_order_idx ON public.admin_deposit_issue_rows USING btree (order_number, utr);
CREATE INDEX admin_deposit_issue_rows_scope_idx ON public.admin_deposit_issue_rows USING btree (country, platform, record_date DESC);
alter table public.admin_deposit_issue_rows enable row level security;
revoke all on public.admin_deposit_issue_rows from public,anon,authenticated,service_role;grant all on public.admin_deposit_issue_rows to service_role;
create table public.admin_deposit_followup_rows("id" text not null,"source_sheet" text not null,"source_tab" text not null,"source_gid" bigint,"source_row" integer not null,"platform" text,"country" text,"order_number" text,"work_order_number" text,"utr" text,"amount" numeric(24,2),"provider" text,"provider_reply" text,"followup_status" text,"utr_match" text,"kyc_correct" text,"evidence" text,"followup_at" text,"followup_date" date,"receipt_text" text,"source_updated_at" timestamp with time zone,"updated_at" timestamp with time zone not null,"source_kind" text not null,"first_actor" text,"last_actor" text,"portal_case_id" text,"portal_version" bigint,"portal_owner_id" text,"staff_code" text,"source_date_text" text,"portal_payload" jsonb,"portal_team" text,"upi_id" text,"kyc_upi_id" text,"stale_at" timestamp with time zone);
alter table public.admin_deposit_followup_rows add constraint "admin_deposit_followup_rows_pkey" PRIMARY KEY (id);
alter table public.admin_deposit_followup_rows add constraint "admin_deposit_followup_rows_source_row_check" CHECK ((source_row > 0));
alter table public.admin_deposit_followup_rows add constraint "admin_deposit_followup_rows_source_sheet_source_tab_source__key" UNIQUE (source_sheet, source_tab, source_row);
CREATE INDEX admin_deposit_followup_order_idx ON public.admin_deposit_followup_rows USING btree (order_number, utr);
CREATE INDEX admin_deposit_followup_scope_idx ON public.admin_deposit_followup_rows USING btree (country, platform, followup_date DESC);
alter table public.admin_deposit_followup_rows enable row level security;
revoke all on public.admin_deposit_followup_rows from public,anon,authenticated,service_role;grant all on public.admin_deposit_followup_rows to service_role;
create table public.ar_workorder_issue_details("system_name" text not null,"country_code" text not null,"country" text not null,"platform" text not null,"tenant_id" text,"work_order_id" text not null,"source_record_id" text,"work_order_no" text,"source_order_no" text,"payment_order_no" text,"utr" text,"issue_kind" text not null,"work_order_type_id" integer,"work_order_type_name" text,"work_order_name" text,"status_code" integer,"amount" numeric(24,8),"third_party" text,"third_party_source_name" text,"third_party_mapping_code" text,"third_party_channel_id" text,"channel_type" text,"kyc_connected" boolean,"kyc_status_source" text,"utr_matched" boolean,"reminder_count" integer,"attachment_types" text[],"submitted_at" timestamp with time zone,"operated_at" timestamp with time zone,"operator_account" text,"source_updated_at" timestamp with time zone,"observed_at" timestamp with time zone not null,"query_date" date not null,"schema_version" integer not null,"query_basis" text not null,"submitted_date" date,"last_updated_by" text,"attachment_type_codes" integer[],"operation_time_source" text,"field_gaps" text[] not null,"source_form_id" integer,"source_type_code" integer,"kyc_link_status_code" integer,"is_locked_by_current_user" boolean,"source_vip_level" text,"source_pay_type_id" integer);
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_amount_check" CHECK (((amount >= (0)::numeric) AND ((amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_check" CHECK (((operated_at IS NULL) = (operation_time_source IS NULL)));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_country_check" CHECK (((length(btrim(country)) >= 1) AND (length(btrim(country)) <= 200)));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_country_code_check" CHECK ((country_code ~ '^[A-Z]{2}$'::text));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_issue_kind_check" CHECK ((issue_kind = ANY (ARRAY['deposit'::text, 'withdraw'::text])));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_kyc_link_status_code_check" CHECK ((kyc_link_status_code >= 0));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_observed_at_check" CHECK (isfinite(observed_at));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_operated_at_check" CHECK (isfinite(operated_at));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_operation_time_source_check" CHECK ((operation_time_source = ANY (ARRAY['operationTime'::text, 'operateTime'::text, 'lastUpdateTime'::text])));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_pkey" PRIMARY KEY (system_name, country_code, platform, work_order_id);
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_platform_check" CHECK (((length(btrim(platform)) >= 1) AND (length(btrim(platform)) <= 200)));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_query_basis_check" CHECK ((query_basis = ANY (ARRAY['submission'::text, 'operation'::text])));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_query_date_check" CHECK (isfinite(query_date));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_reminder_count_check" CHECK ((reminder_count >= 0));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_schema_version_check" CHECK ((schema_version = 2));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_source_form_id_check" CHECK ((source_form_id >= 0));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_source_pay_type_id_check" CHECK ((source_pay_type_id >= 0));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_source_type_code_check" CHECK ((source_type_code >= '-1'::integer));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_source_updated_at_check" CHECK (isfinite(source_updated_at));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_source_vip_level_check" CHECK (((length(source_vip_level) >= 1) AND (length(source_vip_level) <= 32)));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_status_code_check" CHECK (((status_code >= 1) AND (status_code <= 5)));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_submitted_at_check" CHECK (isfinite(submitted_at));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_submitted_date_check" CHECK (isfinite(submitted_date));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_system_name_check" CHECK ((system_name = 'AR'::text));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_work_order_id_check" CHECK (((length(btrim(work_order_id)) >= 1) AND (length(btrim(work_order_id)) <= 200)));
alter table public.ar_workorder_issue_details add constraint "ar_workorder_issue_details_work_order_type_id_check" CHECK ((work_order_type_id >= 0));
CREATE INDEX ar_deposit_order_operation_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, operated_at, work_order_id) WHERE ((issue_kind = 'deposit'::text) AND (operation_time_source IS NOT NULL));
CREATE INDEX ar_deposit_order_payment_v1_idx ON public.ar_workorder_issue_details USING btree (system_name, country_code, platform, payment_order_no, work_order_id) WHERE ((issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL));
CREATE INDEX ar_deposit_order_submission_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_date, work_order_id) WHERE (issue_kind = 'deposit'::text);
CREATE INDEX ar_evidence_retention_state4_v1 ON public.ar_workorder_issue_details USING btree (system_name, country_code, platform, work_order_id) WHERE (status_code = 4);
CREATE INDEX ar_workorder_analysis_submission_cover_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_date, submitted_at, work_order_id) INCLUDE (payment_order_no, issue_kind, status_code, amount, operated_at) WHERE (system_name = 'AR'::text);
CREATE INDEX ar_workorder_deposit_original_identity_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, upper(NULLIF(btrim(payment_order_no), ''::text))) INCLUDE (work_order_id, payment_order_no) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL));
CREATE INDEX ar_workorder_deposit_safe_cover_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, work_order_id) INCLUDE (work_order_no, payment_order_no, amount, third_party, channel_type, kyc_connected, status_code, submitted_date, submitted_at, observed_at, utr) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND ((((((((octet_length(COALESCE(country_code, ''::text)) + octet_length(COALESCE(platform, ''::text))) + octet_length(COALESCE(work_order_id, ''::text))) + octet_length(COALESCE(work_order_no, ''::text))) + octet_length(COALESCE(payment_order_no, ''::text))) + octet_length(COALESCE(third_party, ''::text))) + octet_length(COALESCE(channel_type, ''::text))) + octet_length(COALESCE(utr, ''::text))) <= 1500));
CREATE INDEX ar_workorder_issue_details_operation_v2_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, operated_at, work_order_id) WHERE (operation_time_source IS NOT NULL);
CREATE INDEX ar_workorder_issue_details_submission_v2_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_date, submitted_at, work_order_id);
CREATE INDEX ar_workorder_issue_details_submitted_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_at DESC) WHERE (submitted_at IS NOT NULL);
CREATE INDEX ar_workorder_records_payment_order_no_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(payment_order_no));
CREATE INDEX ar_workorder_records_source_order_no_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(source_order_no));
CREATE INDEX ar_workorder_records_utr_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(utr));
CREATE INDEX ar_workorder_records_work_order_id_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(work_order_id));
CREATE INDEX ar_workorder_records_work_order_no_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(work_order_no));
alter table public.ar_workorder_issue_details enable row level security;
revoke all on public.ar_workorder_issue_details from public,anon,authenticated,service_role;grant select,insert,update on public.ar_workorder_issue_details to service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_platforms()
 RETURNS TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_scope jsonb := private.dashboard_admin_live_scope();
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  return query
  with ar_targets as (
    select md5('ar:'||t.country_code||':'||src.platform)::uuid as id,
      coalesce(m.platform_name,t.platform)::text as name,
      case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,
      t.country_name::text as country,t.country_code::text as scope_group,
      'ar'::text as source,
      coalesce(nullif(t.timezone,''),case t.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end)::text as timezone,
      coalesce(nullif(t.currency,''),case t.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end)::text as currency,
      src.platform::text as source_name
    from public.ar_config_targets t
    cross join lateral (
      select case when t.country_code='IN' and upper(btrim(t.platform))='SHREEWIN'
        and not exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
          and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
        then 'Shree.Win' else t.platform end as platform
    ) src
    left join public.dashboard_platform_team_map m on m.active
      and m.source_system=case when t.source_system='NEW_AR' then 'NEW_AR' else 'AR' end
      and (m.source_country=t.country_name or m.source_country=t.country_code)
      and upper(btrim(m.source_platform))=upper(btrim(src.platform))
    where private.dashboard_scope_allows(v_scope,t.country_code,t.platform)
      and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
        where n.platform=t.platform and n.country_code=t.country_code and n.enabled
          and (n.launch_at is null or n.launch_at<=now()) offset 0))
  ),
  ar_mapped_only as (
    select md5('ar:'||m.country_code||':'||m.source_platform)::uuid as id,
      m.platform_name::text as name,case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,m.country_name::text as country,
      m.country_code::text as scope_group,'ar'::text as source,
      case m.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end::text as timezone,
      case m.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end::text as currency,
      m.source_platform::text as source_name
    from public.dashboard_platform_team_map m
    where m.active and m.source_system='AR'
      and private.dashboard_scope_allows(v_scope,m.country_code,m.source_platform)
      and not exists(select 1 from public.ar_config_targets t
        where t.country_code=m.country_code
          and upper(btrim(t.platform))=upper(btrim(m.source_platform)))
  )
  select g.id,g.platform_name,case when upper(btrim(g.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else g.team_name end,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text,g.platform_name
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
    and (exists(select 1 from public.game66_charge_orders c where c.platform_id=g.id offset 0)
      or exists(select 1 from public.game66_withdraw_orders w where w.platform_id=g.id offset 0))
  union all
  select ar_targets.id,ar_targets.name,ar_targets.team,ar_targets.country,ar_targets.scope_group,ar_targets.source,ar_targets.timezone,ar_targets.currency,ar_targets.source_name from ar_targets
  union all
  select ar_mapped_only.id,ar_mapped_only.name,ar_mapped_only.team,ar_mapped_only.country,ar_mapped_only.scope_group,ar_mapped_only.source,ar_mapped_only.timezone,ar_mapped_only.currency,ar_mapped_only.source_name from ar_mapped_only
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,
    coalesce(m.platform_name,n.platform),case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end,n.country,n.country_code,
    'newar'::text,n.timezone,n.currency,n.platform
  from public.newar_detail_platforms n
  left join public.dashboard_platform_team_map m on m.active and m.source_system='NEW_AR'
    and (m.source_country=n.country or m.source_country=n.country_code)
    and upper(btrim(m.source_platform))=upper(btrim(n.platform))
  where n.enabled and (n.launch_at is null or n.launch_at<=now())
    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
  union all
  -- Only real current LG order scopes qualify. The historical raw LG/SUPERLG
  -- report mapping is not a PH order scope and cannot create a duplicate row.
  select md5('lg:'||l.country_code||':'||l.platform)::uuid,
    coalesce(m.platform_name,l.platform),m.team_name,
    case l.country_code when 'PH' then '菲律宾' when 'ID' then '印尼' when 'PK' then '巴基斯坦' end,
    l.country_code,'lg'::text,public.lg_country_timezone(l.country_code),
    case l.country_code when 'PH' then 'PHP' when 'ID' then 'IDR' when 'PK' then 'PKR' end,l.platform
  from private.dashboard_admin_live_lg_scopes() l
  left join lateral (
    select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='LG' and t.source_platform=l.platform
      and t.country_code=l.country_code and t.source_country in (l.country_code,
        case l.country_code when 'PH' then '菲律宾' when 'ID' then '印尼' when 'PK' then '巴基斯坦' end)
    order by (t.source_country=l.country_code) desc,t.source_country limit 1
  )m on true
  where l.country_code=public.lg_platform_country(l.platform)
    and public.lg_country_timezone(l.country_code) is not null
    and private.dashboard_scope_allows(v_scope,l.country_code,l.platform)

  union all
  select md5('WG:'||w.site_code)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
    'wg'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_wg_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='WG' and t.country_code=w.country_code
      and upper(btrim(t.source_platform))=w.platform
    order by (t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)

  union all
  select md5('duoli:ID:'||w.platform)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
   'duoli'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_duoli_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
   where t.active and t.source_system in('DOLI','REPORT') and t.country_code=w.country_code
    and upper(btrim(t.source_platform))=w.platform
   order by (t.source_system='DOLI') desc,(t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)

 union all
 select md5('kb:IN:YASH.BET')::uuid,coalesce(m.platform_name,'YASH.BET'),m.team_name,'印度'::text,'IN'::text,
  'kb'::text,'Asia/Kolkata'::text,'INR'::text,'YASH.BET'::text
 from (values(1))s(n)
 left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='KB' and t.country_code='IN' and upper(btrim(t.source_platform))='YASH.BET'
  order by (t.source_country='IN') desc,t.source_country limit 1)m on true
 where private.dashboard_scope_allows(v_scope,'IN','YASH.BET')

 union all
 select md5('panda:BR:'||s.platform)::uuid,s.platform_label,
  coalesce(m.team_name,case when private.dashboard_admin_live_is_panghu_platform(s.platform_label) then '胖虎' end),
  '巴西'::text,private.dashboard_data_group('BR',s.platform_label),'panda'::text,'America/Sao_Paulo'::text,'BRL'::text,s.platform_label
 from panda_private.order_scopes s
 left join lateral (select t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='PANDA' and t.source_platform=s.platform_label
   and t.country_code in('BR','BR_PANGHU') order by t.source_country limit 1)m on true
 where s.country_code='BR' and s.currency='BRL' and s.region_id=1 and s.platform in('platform_12601','platform_12609','platform_13610','platform_16615','platform_170','platform_17530','platform_1930841','platform_208','platform_222vip','platform_2231','platform_2250','platform_2269','platform_2279','platform_231','platform_234t','platform_235','platform_2382','platform_2431','platform_2461','platform_2470','platform_2537','platform_2v222','platform_345f','platform_406','platform_428','platform_447','platform_448','platform_45ff','platform_559k','platform_56l','platform_596','platform_609','platform_613','platform_620','platform_647','platform_67vip','platform_723','platform_737','platform_755','platform_756','platform_759','platform_76pp','platform_776f','platform_798','platform_800','platform_801','platform_802','platform_8566bet','platform_888hh','platform_96f','platform_985','platform_987','platform_998','platform_bet5697')
  and private.dashboard_scope_allows(v_scope,'BR',s.platform_label)
;
end;
$function$
;
revoke all on function private.dashboard_admin_live_platforms() from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_platforms() to authenticated;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_key(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case upper(btrim(p_name)) when 'DHANI.WIN' then 'DHANIWIN' when 'SHREE.WIN' then 'SHREEWIN'
 when 'VEER.GAME' then 'VEERGAME' when 'MAAN.WIN' then 'MAANWIN' else upper(btrim(p_name)) end;
$function$
;
revoke all on function private.dashboard_admin_live_withdraw_key(text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_scope_allows(p_scope jsonb, p_country text, p_platform text DEFAULT ''::text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_group text;v_key text;
begin
 if not private.dashboard_data_scope_valid(p_scope) then return false;end if;
 if p_scope->>'mode'='all' then return true;end if;
 v_group:=private.dashboard_data_group(p_country,p_platform);
 if v_group='' then return false;end if;
 if p_scope ? 'platforms' then
  v_key:=private.dashboard_scope_platform_identity(v_group,p_platform);
  return v_key is not null and (jsonb_array_length(p_scope->'countries')=0 or (p_scope->'countries') ? v_group)
   and exists(select 1 from jsonb_array_elements(p_scope->'platforms') e
    where e->>'country'=v_group and private.dashboard_scope_platform_identity(v_group,e->>'platform')=v_key);
 end if;
 return (p_scope->'countries') ? v_group;
end;
$function$
;
revoke all on function private.dashboard_scope_allows(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_scope_allows(jsonb,text,text) to authenticated;
grant execute on function private.dashboard_scope_allows(jsonb,text,text) to service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_scope()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_profile public.dashboard_profiles%rowtype;
begin
  if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied'; end if;
  perform private.dashboard_role_require_gateway(); -- assigned-role signed gateway
  if v_user is null then raise exception using errcode='28000',message='login_required'; end if;
  select * into v_profile from public.dashboard_profiles where auth_user_id=v_user;
  if not found or v_profile.active is not true or coalesce(v_profile.role,'') not in ('owner','admin','viewer') then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  if v_profile.role<>'owner' and not exists(select 1 from public.dashboard_admin_preview_grants
      where auth_user_id=v_user and can_view is true) then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  -- Fresh production scope, independent of the old third_party module grant.
  return private.dashboard_current_data_scope();
end;
$function$
;
revoke all on function private.dashboard_admin_live_scope() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_deposit_platform_key(p_country text, p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when p_country in ('印度','IN','India') and upper(btrim(p_name))='INDIA82' then '82LOTTERY'
 else private.dashboard_admin_live_withdraw_key(p_name) end;
$function$
;
revoke all on function private.dashboard_admin_live_deposit_platform_key(text,text) from public,anon,authenticated,service_role;
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
revoke all on function private.workorder_receipt_date(text) from public,anon,authenticated,service_role;
grant execute on function private.workorder_receipt_date(text) to service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_deposit_statistics(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '20s'
AS $function$
begin
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_collected_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$function$
;
revoke all on function private.dashboard_admin_deposit_statistics(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_deposit_statistics(jsonb) to authenticated;
CREATE OR REPLACE FUNCTION private.dashboard_role_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.dashboard_profiles%rowtype;a private.dashboard_role_assignments%rowtype;r private.dashboard_roles%rowtype;v_view boolean;v_permissions jsonb;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='login_required';end if;
 select * into p from public.dashboard_profiles where auth_user_id=auth.uid();
 if not found or p.active is not true or coalesce(p.role,'') not in ('owner','admin','viewer') then raise exception using errcode='42501',message='profile_denied';end if;
 if p.role='owner' then
  select coalesce(jsonb_agg(c->>'key' order by c->>'key'),'[]'::jsonb) into v_permissions from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c;
  return jsonb_build_object('mode','owner','roleId',null,'roleName',null,'version',0,'assignmentVersion',0,'permissions',v_permissions,'canView',true);
 end if;
 select * into a from private.dashboard_role_assignments where auth_user_id=p.auth_user_id;
 v_view:=exists(select 1 from public.dashboard_admin_preview_grants g where g.auth_user_id=p.auth_user_id and g.can_view);
 if a.auth_user_id is null then
  select coalesce(jsonb_agg(c->>'key' order by c->>'key'),'[]'::jsonb) into v_permissions from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c;
  return jsonb_build_object('mode','legacy','roleId',null,'roleName',null,'version',0,'assignmentVersion',0,'permissions',v_permissions,'canView',v_view);
 end if;
 select * into r from private.dashboard_roles where id=a.role_id;
 if not found then raise exception using errcode='42501',message='role_unavailable';end if;
 -- Retired directory permissions never grant a visible page or gateway access.
 r.permissions:=array(select permission_code from unnest(r.permissions) permission_code
  where permission_code<>all(array['channelquality.view','channelquality.query','channelquality.detail','channelquality.export']::text[]));
 return jsonb_build_object('mode','assigned','roleId',r.id,'roleName',r.name,'version',r.version,'assignmentVersion',a.version,
   'permissions',case when r.active then to_jsonb(r.permissions) else '[]'::jsonb end,
   'canView',v_view and r.active and exists(select 1 from unnest(r.permissions) k where right(k,5)='.view'));
end;$function$
;
revoke all on function private.dashboard_role_access() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.dashboard_admin_execute(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a jsonb;page jsonb;action text;capability text;rpc text;payload jsonb;signature text;k bytea;
 args jsonb;result jsonb;prior text;v_view text;v_operation text;needed text[];
begin
 a:=private.dashboard_role_access();
 if a->>'mode'<>'assigned' or not (a->>'canView')::boolean then raise exception using errcode='42501',message='assigned_role_required';end if;
 if p_page is null or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or jsonb_typeof(p_request->'action') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages') where value->>'id'=p_page;
 action:=p_request->>'action';v_operation:=p_request->>'operation';v_view:=p_request->>'view';
 if page is null or action='portalOperationLogs' or not (page->'requests') ? action
  or not (a->'permissions') ? (p_page||'.view') then raise exception using errcode='42501',message='page_action_denied';end if;
 capability:=case when action in ('catalog','providerOptions','configurationAccess') then 'view'
   when action='withdrawNote' then 'edit' when action='configurationWrite' and v_operation='grant' then 'grant'
   when action='configurationWrite' then 'edit' else 'query' end;
 needed:=array[p_page||'.view',p_page||'.'||capability];
 if action in ('details','query','analysisOrders','pendingOrders') or action='aggregate' and v_view='drilldown'
  or action in ('submissionAnalysis','submissionStreak') and v_operation in ('members','memberOrders')
  or action='workorderRecords' and v_operation in ('detail','orderDetail')
  or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders')
  or action='depositIssues' and p_page='deposit_statistics'
 then needed:=array_append(needed,p_page||'.detail');end if;
 if not (a->'permissions') ?& needed then raise exception using errcode='42501',message='role_permission_denied';end if;
 if action='configurationWrite' and not (v_operation='grant' and p_page in ('provider_config','teams')
  or v_operation='provider' and p_page='provider_config' or v_operation='platform' and p_page='teams') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='workorderRecords' and not (p_page='workorders' and coalesce(v_view,'records') in ('records','orders')
  or p_page='workorder_reconciliation' and v_view='missing' or p_page='workorder_workload' and v_view='workload') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='autoWithdraw' and (p_page='withdraw_operators' and coalesce(v_view,'auto')<>'operators'
  or p_page in ('auto_withdraw','overview') and coalesce(v_view,'auto')<>'auto') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='submissionStreak' and p_page<>'events' then
  raise exception using errcode='42501',message='page_action_denied';end if;
 rpc:=case action
  when 'channelStatus' then 'dashboard_admin_live_channel_status'
  when 'submissionAnalysis' then 'dashboard_admin_live_submission_analysis'
  when 'submissionStreak' then 'dashboard_admin_live_submission_streak'
  when 'memberDaily' then 'dashboard_admin_live_member_daily'
  when 'pendingSnapshot' then 'dashboard_admin_live_pending_snapshot'
  when 'pendingAnalysis' then 'dashboard_admin_live_pending_analysis'
  when 'pendingOrders' then 'dashboard_admin_live_pending_orders'
  when 'depositStatistics' then 'dashboard_admin_deposit_statistics'
  when 'workorderRecords' then 'dashboard_admin_live_workorder_records'
  when 'intakeCoverage' then 'dashboard_admin_live_intake_coverage'
  when 'reportSummary' then 'dashboard_admin_live_report_summary'
  when 'syncHealth' then 'dashboard_admin_live_sync_health'
  when 'collectedData' then 'dashboard_admin_live_collected_data'
  when 'rates' then 'dashboard_admin_live_rates'
  when 'ratesSheet' then 'dashboard_admin_live_rate_sheet'
  when 'payoutConfig' then 'dashboard_admin_live_payout_config'
  when 'autoWithdraw' then 'dashboard_admin_live_auto_withdraw'
  when 'withdrawReasons' then 'dashboard_admin_live_withdraw_reasons'
  when 'withdrawNote' then 'dashboard_admin_live_withdraw_note'
  when 'depositIssues' then 'dashboard_admin_live_deposit_issues'
  when 'workorders' then 'dashboard_admin_live_workorders'
  when 'providerConfig' then 'dashboard_admin_live_provider_config'
  when 'platformAssignments' then 'dashboard_admin_live_platform_assignments'
  when 'providerOptions' then 'dashboard_admin_live_provider_options'
  when 'configurationAccess' then 'dashboard_admin_live_configuration_access'
  when 'configurationWrite' then 'dashboard_admin_live_configuration_write'
  when 'analysisOrders' then 'dashboard_admin_live_analysis_orders'
  when 'aggregate' then case when v_view='drilldown' then 'dashboard_admin_live_drilldown' else 'dashboard_admin_live_query' end
  when 'catalog' then 'dashboard_admin_live_query'
  when 'query' then 'dashboard_admin_live_query'
  when 'details' then 'dashboard_admin_live_query' end;
 if rpc is null then raise exception using errcode='42501',message='page_action_denied';end if;
 args:=case when rpc in ('dashboard_admin_live_query','dashboard_admin_live_drilldown') then p_request else p_request-'action' end;
 payload:=jsonb_build_object('uid',auth.uid(),'txid',pg_current_xact_id()::text,'pid',pg_backend_pid()::text,
  'roleId',a->>'roleId','roleVersion',a->>'version','assignmentVersion',a->>'assignmentVersion','page',p_page,'rpc',rpc,'action',action,'capability',capability);
 select secret into k from private.dashboard_role_context_secret where singleton;
 signature:=private.dashboard_role_hmac(payload::text,k);prior:=current_setting('hensem.dashboard_role_context',true);
 perform set_config('hensem.dashboard_role_context',jsonb_build_object('payload',payload,'signature',signature)::text,true);
 begin
  execute format('select private.%I($1)',rpc) into result using args;
 exception when others then
  perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);raise;
 end;
 perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);
 return result;
end;$function$
;
revoke all on function public.dashboard_admin_execute(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_admin_execute(text,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION public.workorder_followup_mirror(p_record jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$

;
revoke all on function public.workorder_followup_mirror(jsonb)from public,anon,authenticated;grant execute on function public.workorder_followup_mirror(jsonb)to service_role;
