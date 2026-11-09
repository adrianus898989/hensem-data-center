-- Structural fixture for the deployed current-ticket overlay (no source data).
create table newar_detail_platforms (
platform text,
country_code text,
country text,
timezone text,
currency text,
enabled boolean,
launch_at timestamp with time zone
);
create table newar_detail_records (
id uuid,
platform text,
dataset text,
source_id text,
member_id text,
order_number text,
third_party_order_number text,
provider text,
provider_id text,
channel_type text,
currency text,
amount numeric(24,8),
actual_amount numeric(24,8),
fee numeric(24,8),
status_code text,
status_group text,
created_at timestamp with time zone,
success_at timestamp with time zone,
processed_at timestamp with time zone,
source_updated_at timestamp with time zone,
captured_at timestamp with time zone,
workorder_type text,
operator text,
followup_count integer,
raw jsonb,
received_at timestamp with time zone
);
create table ar_workorder_issue_details (
system_name text,
country_code text,
country text,
platform text,
tenant_id text,
work_order_id text,
source_record_id text,
work_order_no text,
source_order_no text,
payment_order_no text,
utr text,
issue_kind text,
work_order_type_id integer,
work_order_type_name text,
work_order_name text,
status_code integer,
amount numeric(24,8),
third_party text,
third_party_source_name text,
third_party_mapping_code text,
third_party_channel_id text,
channel_type text,
kyc_connected boolean,
kyc_status_source text,
utr_matched boolean,
reminder_count integer,
attachment_types text[],
submitted_at timestamp with time zone,
operated_at timestamp with time zone,
operator_account text,
source_updated_at timestamp with time zone,
observed_at timestamp with time zone,
query_date date,
schema_version integer,
query_basis text,
submitted_date date,
last_updated_by text,
attachment_type_codes integer[],
operation_time_source text,
field_gaps text[],
source_form_id integer,
source_type_code integer,
kyc_link_status_code integer,
is_locked_by_current_user boolean,
source_vip_level text,
source_pay_type_id integer
);
create table private.ar_workorder_latest_v1 (
system_name text,
country_code text,
country text,
platform text,
tenant_id text,
work_order_no text,
work_order_no_source text,
source_record_id text,
source_order_no text,
payment_order_no text,
issue_kind text,
work_order_type_name text,
work_order_name text,
operation_time_source text,
submitted_at timestamp with time zone,
submitted_date date,
state_code smallint,
state_name text,
source_updated_at timestamp with time zone,
operated_at timestamp with time zone,
observed_at timestamp with time zone
);
CREATE OR REPLACE FUNCTION private.workorder_version_v1(n_event timestamp with time zone, n_observed timestamp with time zone, o_event timestamp with time zone, o_observed timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
 SELECT CASE
 WHEN n_event IS NOT NULL AND o_event IS NOT NULL AND n_event<>o_event THEN CASE WHEN n_event>o_event THEN 1 ELSE -1 END
 WHEN n_event IS NULL AND o_event IS NOT NULL THEN -1
 WHEN n_observed>o_observed THEN 1 WHEN n_observed<o_observed THEN -1
 WHEN n_event IS NOT NULL AND o_event IS NULL THEN 1 ELSE 0 END
$function$
;
create view private.ar_current_workorder_rows_v1 as  SELECT d.system_name,
    d.country_code,
    d.country,
    d.platform,
    d.tenant_id,
    d.work_order_id,
    d.source_record_id,
    d.work_order_no,
    d.source_order_no,
    d.payment_order_no,
    d.utr,
    d.issue_kind,
    d.work_order_type_id,
    d.work_order_type_name,
    d.work_order_name,
    d.status_code,
    d.amount,
    d.third_party,
    d.third_party_source_name,
    d.third_party_mapping_code,
    d.third_party_channel_id,
    d.channel_type,
    d.kyc_connected,
    d.kyc_status_source,
    d.utr_matched,
    d.reminder_count,
    d.attachment_types,
    d.submitted_at,
    d.operated_at,
    d.operator_account,
    d.source_updated_at,
    d.observed_at,
    d.query_date,
    d.schema_version,
    d.query_basis,
    d.submitted_date,
    d.last_updated_by,
    d.attachment_type_codes,
    d.operation_time_source,
    d.field_gaps,
    d.source_form_id,
    d.source_type_code,
    d.kyc_link_status_code,
    d.is_locked_by_current_user,
    d.source_vip_level,
    d.source_pay_type_id
   FROM public.ar_workorder_issue_details d
  WHERE ((NOT (EXISTS ( SELECT
           FROM private.ar_workorder_latest_v1 l
          WHERE ((l.system_name = d.system_name) AND (l.country_code = d.country_code) AND (l.tenant_id = d.tenant_id) AND (l.platform = d.platform) AND (l.source_record_id = d.work_order_id) AND (l.source_record_id = d.source_record_id))))) AND (NOT (EXISTS ( SELECT
           FROM private.ar_workorder_latest_v1 l
          WHERE ((l.system_name = d.system_name) AND (l.country_code = d.country_code) AND (l.tenant_id = d.tenant_id) AND (l.platform = d.platform) AND (l.work_order_no = d.work_order_id) AND (l.work_order_no = d.work_order_no) AND ((l.source_record_id IS NULL) OR (d.source_record_id IS NULL) OR (l.source_record_id = d.source_record_id)))))))
UNION ALL
 SELECT l.system_name,
    l.country_code,
    l.country,
    l.platform,
    l.tenant_id,
        CASE
            WHEN (d.work_order_id IS NULL) THEN COALESCE(l.source_record_id, l.work_order_no)
            ELSE d.work_order_id
        END AS work_order_id,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.source_record_id
            ELSE
            CASE
                WHEN v.use_new THEN COALESCE(l.source_record_id, d.source_record_id)
                ELSE d.source_record_id
            END
        END AS source_record_id,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.work_order_no
            ELSE
            CASE
                WHEN v.use_new THEN COALESCE(l.work_order_no, d.work_order_no)
                ELSE d.work_order_no
            END
        END AS work_order_no,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.source_order_no
            ELSE
            CASE
                WHEN v.use_new THEN COALESCE(l.source_order_no, d.source_order_no)
                ELSE d.source_order_no
            END
        END AS source_order_no,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.payment_order_no
            ELSE
            CASE
                WHEN v.use_new THEN COALESCE(l.payment_order_no, d.payment_order_no)
                ELSE d.payment_order_no
            END
        END AS payment_order_no,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.utr
        END AS utr,
        CASE
            WHEN (d.work_order_id IS NULL) THEN COALESCE(l.issue_kind, 'other'::text)
            ELSE d.issue_kind
        END AS issue_kind,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.work_order_type_id
        END AS work_order_type_id,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.work_order_type_name
            ELSE
            CASE
                WHEN v.use_new THEN COALESCE(l.work_order_type_name, d.work_order_type_name)
                ELSE d.work_order_type_name
            END
        END AS work_order_type_name,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.work_order_name
            ELSE
            CASE
                WHEN v.use_new THEN COALESCE(l.work_order_name, d.work_order_name)
                ELSE d.work_order_name
            END
        END AS work_order_name,
        CASE
            WHEN (d.work_order_id IS NULL) THEN (l.state_code)::integer
            ELSE
            CASE
                WHEN v.use_new THEN (l.state_code)::integer
                ELSE d.status_code
            END
        END AS status_code,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::numeric(24,8)
            ELSE d.amount
        END AS amount,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.third_party
        END AS third_party,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.third_party_source_name
        END AS third_party_source_name,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.third_party_mapping_code
        END AS third_party_mapping_code,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.third_party_channel_id
        END AS third_party_channel_id,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.channel_type
        END AS channel_type,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::boolean
            ELSE d.kyc_connected
        END AS kyc_connected,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.kyc_status_source
        END AS kyc_status_source,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::boolean
            ELSE d.utr_matched
        END AS utr_matched,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.reminder_count
        END AS reminder_count,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text[]
            ELSE d.attachment_types
        END AS attachment_types,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.submitted_at
            ELSE LEAST(l.submitted_at, d.submitted_at)
        END AS submitted_at,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.operated_at
            ELSE
            CASE
                WHEN v.use_new THEN GREATEST(l.operated_at, d.operated_at)
                ELSE d.operated_at
            END
        END AS operated_at,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.operator_account
        END AS operator_account,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.source_updated_at
            ELSE
            CASE
                WHEN v.use_new THEN GREATEST(l.source_updated_at, d.source_updated_at)
                ELSE d.source_updated_at
            END
        END AS source_updated_at,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.observed_at
            ELSE
            CASE
                WHEN v.use_new THEN l.observed_at
                ELSE d.observed_at
            END
        END AS observed_at,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::date
            ELSE d.query_date
        END AS query_date,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.schema_version
        END AS schema_version,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.query_basis
        END AS query_basis,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.submitted_date
            ELSE LEAST(l.submitted_date, d.submitted_date)
        END AS submitted_date,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.last_updated_by
        END AS last_updated_by,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer[]
            ELSE d.attachment_type_codes
        END AS attachment_type_codes,
        CASE
            WHEN (d.work_order_id IS NULL) THEN l.operation_time_source
            ELSE
            CASE
                WHEN (v.use_new AND (l.operated_at IS NOT NULL) AND ((d.operated_at IS NULL) OR (l.operated_at >= d.operated_at))) THEN COALESCE(l.operation_time_source, d.operation_time_source)
                ELSE d.operation_time_source
            END
        END AS operation_time_source,
        CASE
            WHEN (d.work_order_id IS NULL) THEN ARRAY['source_snapshot_only'::text]
            ELSE d.field_gaps
        END AS field_gaps,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.source_form_id
        END AS source_form_id,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.source_type_code
        END AS source_type_code,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.kyc_link_status_code
        END AS kyc_link_status_code,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::boolean
            ELSE d.is_locked_by_current_user
        END AS is_locked_by_current_user,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::text
            ELSE d.source_vip_level
        END AS source_vip_level,
        CASE
            WHEN (d.work_order_id IS NULL) THEN NULL::integer
            ELSE d.source_pay_type_id
        END AS source_pay_type_id
   FROM ((((private.ar_workorder_latest_v1 l
     LEFT JOIN public.ar_workorder_issue_details a ON (((l.system_name = a.system_name) AND (l.country_code = a.country_code) AND (l.tenant_id = a.tenant_id) AND (l.platform = a.platform) AND (l.source_record_id = a.work_order_id) AND (l.source_record_id = a.source_record_id))))
     LEFT JOIN public.ar_workorder_issue_details b ON (((a.work_order_id IS NULL) AND (l.system_name = b.system_name) AND (l.country_code = b.country_code) AND (l.tenant_id = b.tenant_id) AND (l.platform = b.platform) AND (l.work_order_no = b.work_order_id) AND (l.work_order_no = b.work_order_no) AND ((l.source_record_id IS NULL) OR (b.source_record_id IS NULL) OR (l.source_record_id = b.source_record_id)))))
     CROSS JOIN LATERAL ( SELECT (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).system_name AS system_name,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).country_code AS country_code,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).country AS country,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).platform AS platform,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).tenant_id AS tenant_id,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).work_order_id AS work_order_id,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_record_id AS source_record_id,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).work_order_no AS work_order_no,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_order_no AS source_order_no,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).payment_order_no AS payment_order_no,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).utr AS utr,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).issue_kind AS issue_kind,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).work_order_type_id AS work_order_type_id,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).work_order_type_name AS work_order_type_name,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).work_order_name AS work_order_name,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).status_code AS status_code,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).amount AS amount,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).third_party AS third_party,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).third_party_source_name AS third_party_source_name,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).third_party_mapping_code AS third_party_mapping_code,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).third_party_channel_id AS third_party_channel_id,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).channel_type AS channel_type,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).kyc_connected AS kyc_connected,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).kyc_status_source AS kyc_status_source,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).utr_matched AS utr_matched,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).reminder_count AS reminder_count,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).attachment_types AS attachment_types,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).submitted_at AS submitted_at,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).operated_at AS operated_at,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).operator_account AS operator_account,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_updated_at AS source_updated_at,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).observed_at AS observed_at,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).query_date AS query_date,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).schema_version AS schema_version,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).query_basis AS query_basis,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).submitted_date AS submitted_date,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).last_updated_by AS last_updated_by,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).attachment_type_codes AS attachment_type_codes,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).operation_time_source AS operation_time_source,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).field_gaps AS field_gaps,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_form_id AS source_form_id,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_type_code AS source_type_code,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).kyc_link_status_code AS kyc_link_status_code,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).is_locked_by_current_user AS is_locked_by_current_user,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_vip_level AS source_vip_level,
            (
                CASE
                    WHEN (a.work_order_id IS NOT NULL) THEN a.*
                    ELSE b.*
                END).source_pay_type_id AS source_pay_type_id) d)
     CROSS JOIN LATERAL ( SELECT (private.workorder_version_v1(GREATEST(l.source_updated_at, l.operated_at), l.observed_at, GREATEST(d.source_updated_at, d.operated_at), d.observed_at) > 0) AS use_new
         OFFSET 0) v);