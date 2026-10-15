create schema private;create schema extensions;create extension pgcrypto with schema extensions;
create role anon nologin;create role authenticated nologin;create role service_role nologin;
grant usage on schema public to anon,authenticated,service_role;
set search_path='';
CREATE TABLE private.duoli_detail_batches_v2(
"id" uuid NOT NULL,
"kind" text COLLATE "pg_catalog"."default" NOT NULL,
"window_id" uuid NOT NULL,
"platform" text COLLATE "pg_catalog"."default" NOT NULL,
"business" text COLLATE "pg_catalog"."default" NOT NULL,
"stream" text COLLATE "pg_catalog"."default" NOT NULL,
"start_at" timestamp with time zone NOT NULL,
"end_exclusive" timestamp with time zone NOT NULL,
"observed_at" timestamp with time zone,
"body_hash" text COLLATE "pg_catalog"."default" NOT NULL,
"source_order_hashes" text[] COLLATE "pg_catalog"."default" DEFAULT '{}'::text[] NOT NULL,
"received" integer NOT NULL,
"written" integer NOT NULL,
"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_body_hash_check" CHECK ((body_hash ~ '^[0-9a-f]{64}$'::text));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_business_check" CHECK ((business = ANY (ARRAY['recharge'::text, 'withdraw'::text])));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_check" CHECK ((end_exclusive > start_at));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_check1" CHECK (((written >= 0) AND (written <= received)));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_check2" CHECK (((stream <> 'created'::text) OR (business = 'recharge'::text)));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_check3" CHECK ((((kind = 'batch'::text) AND (id <> window_id) AND ((received >= 1) AND (received <= 200)) AND (cardinality(source_order_hashes) = received)) OR ((kind = 'finalize'::text) AND (id = window_id) AND (cardinality(source_order_hashes) = 0))));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_kind_check" CHECK ((kind = ANY (ARRAY['batch'::text, 'finalize'::text])));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_pkey" PRIMARY KEY (id);
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_platform_check" CHECK ((platform = ANY (ARRAY['UANG'::text, 'HOT985'::text, 'IND666'::text, 'FB168'::text, 'FB333'::text])));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_received_check" CHECK ((received >= 0));
ALTER TABLE private.duoli_detail_batches_v2 ADD CONSTRAINT "duoli_detail_batches_v2_stream_check" CHECK ((stream = ANY (ARRAY['created'::text, 'updated'::text])));
CREATE INDEX duoli_detail_batches_v2_window_idx ON private.duoli_detail_batches_v2 USING btree (window_id, kind);
ALTER TABLE private.duoli_detail_batches_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.duoli_detail_batches_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.duoli_detail_credentials(
"key_hash" text COLLATE "pg_catalog"."default" NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"scope" jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE private.duoli_detail_credentials ADD CONSTRAINT "duoli_detail_credentials_key_hash_check" CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text));
ALTER TABLE private.duoli_detail_credentials ADD CONSTRAINT "duoli_detail_credentials_pkey" PRIMARY KEY (key_hash);
ALTER TABLE private.duoli_detail_credentials ADD CONSTRAINT "duoli_detail_credentials_scope_check" CHECK ((scope = '{"system": "DOLI", "country": "ID", "platforms": ["UANG", "HOT985", "IND666", "FB168", "FB333"]}'::jsonb));
ALTER TABLE private.duoli_detail_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.duoli_detail_credentials FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.duoli_detail_progress_v2(
"platform" text COLLATE "pg_catalog"."default" NOT NULL,
"business" text COLLATE "pg_catalog"."default" NOT NULL,
"stream" text COLLATE "pg_catalog"."default" NOT NULL,
"start_at" timestamp with time zone NOT NULL,
"end_exclusive" timestamp with time zone NOT NULL,
"source_count" integer NOT NULL,
"uploaded_count" integer NOT NULL,
"window_id" uuid NOT NULL,
"finalized" boolean NOT NULL,
"status_coverage" text COLLATE "pg_catalog"."default" NOT NULL,
"query_mode" text COLLATE "pg_catalog"."default" NOT NULL,
"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_business_check" CHECK ((business = ANY (ARRAY['recharge'::text, 'withdraw'::text])));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_check" CHECK ((end_exclusive > start_at));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_check1" CHECK ((uploaded_count = source_count));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_check2" CHECK (((stream <> 'created'::text) OR (business = 'recharge'::text)));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_finalized_check" CHECK (finalized);
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_pkey" PRIMARY KEY (platform, business, stream);
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_platform_check" CHECK ((platform = ANY (ARRAY['UANG'::text, 'HOT985'::text, 'IND666'::text, 'FB168'::text, 'FB333'::text])));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_query_mode_check" CHECK ((query_mode = 'source_time_stream'::text));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_source_count_check" CHECK ((source_count >= 0));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_status_coverage_check" CHECK ((status_coverage = 'requested_all_unverified'::text));
ALTER TABLE private.duoli_detail_progress_v2 ADD CONSTRAINT "duoli_detail_progress_v2_stream_check" CHECK ((stream = ANY (ARRAY['created'::text, 'updated'::text])));
ALTER TABLE private.duoli_detail_progress_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.duoli_detail_progress_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.duoli_order_details(
"platform" text COLLATE "pg_catalog"."default" NOT NULL,
"business" text COLLATE "pg_catalog"."default" NOT NULL,
"source_order_id" text COLLATE "pg_catalog"."default" NOT NULL,
"source_order_hash" text COLLATE "pg_catalog"."default" NOT NULL,
"system_name" text COLLATE "pg_catalog"."default" DEFAULT 'DOLI'::text NOT NULL,
"country" text COLLATE "pg_catalog"."default" DEFAULT 'ID'::text NOT NULL,
"order_id" text COLLATE "pg_catalog"."default" NOT NULL,
"order_no" text COLLATE "pg_catalog"."default",
"member_id" text COLLATE "pg_catalog"."default",
"created_at" timestamp with time zone NOT NULL,
"created_day" date NOT NULL,
"updated_at" timestamp with time zone,
"status_code" text COLLATE "pg_catalog"."default",
"status_text" text COLLATE "pg_catalog"."default",
"currency" text COLLATE "pg_catalog"."default",
"operator" text COLLATE "pg_catalog"."default",
"provider" text COLLATE "pg_catalog"."default",
"provider_code" text COLLATE "pg_catalog"."default",
"channel" text COLLATE "pg_catalog"."default",
"amount_raw" text COLLATE "pg_catalog"."default",
"amount_source" text COLLATE "pg_catalog"."default",
"amount_unit" text COLLATE "pg_catalog"."default" NOT NULL,
"amount_fields_raw" jsonb NOT NULL,
"raw_projection" jsonb NOT NULL,
"observed_at" timestamp with time zone NOT NULL,
"received_at" timestamp with time zone DEFAULT now() NOT NULL,
"audit_completed_at" timestamp with time zone,
"audit_duration_seconds" bigint
);
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_detail_audit_completed_check" CHECK (((audit_completed_at IS NULL) OR (audit_completed_at >= created_at)));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_detail_audit_duration_check" CHECK (((audit_duration_seconds IS NULL) OR ((audit_duration_seconds >= 0) AND (audit_duration_seconds <= '9007199254740991'::bigint))));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_amount_fields_raw_check" CHECK ((jsonb_typeof(amount_fields_raw) = 'object'::text));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_amount_unit_check" CHECK ((amount_unit = 'source_unverified'::text));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_business_check" CHECK ((business = ANY (ARRAY['recharge'::text, 'withdraw'::text])));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_check" CHECK ((created_day = ((created_at AT TIME ZONE 'Asia/Bangkok'::text))::date));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_check1" CHECK (((updated_at IS NULL) OR (updated_at >= created_at)));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_country_check" CHECK ((country = 'ID'::text));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_pkey" PRIMARY KEY (platform, business, source_order_id);
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_platform_check" CHECK ((platform = ANY (ARRAY['UANG'::text, 'HOT985'::text, 'IND666'::text, 'FB168'::text, 'FB333'::text])));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_raw_projection_check" CHECK ((jsonb_typeof(raw_projection) = 'object'::text));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_source_order_hash_check" CHECK ((source_order_hash ~ '^[0-9a-f]{64}$'::text));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_source_order_id_check" CHECK (((length(source_order_id) >= 1) AND (length(source_order_id) <= 512)));
ALTER TABLE private.duoli_order_details ADD CONSTRAINT "duoli_order_details_system_name_check" CHECK ((system_name = 'DOLI'::text));
CREATE INDEX duoli_order_details_day_idx ON private.duoli_order_details USING btree (platform, business, created_at);
CREATE INDEX duoli_order_details_provider_idx ON private.duoli_order_details USING btree (platform, business, provider_code);
CREATE INDEX duoli_order_details_source_hash_idx ON private.duoli_order_details USING btree (platform, business, source_order_hash);
CREATE INDEX duoli_order_details_updated_idx ON private.duoli_order_details USING btree (platform, business, updated_at) WHERE (updated_at IS NOT NULL);
ALTER TABLE private.duoli_order_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.duoli_order_details FROM PUBLIC,anon,authenticated,service_role;
create table private.duoli_detail_batches (
  id uuid primary key,
  kind text not null check (kind in ('batch','finalize')),
  window_id uuid not null,
  platform text not null check (platform in ('UANG','HOT985','IND666','FB168','FB333')),
  business text not null check (business in ('recharge','withdraw')),
  local_day date not null,
  end_exclusive timestamptz not null,
  observed_at timestamptz,
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  source_order_hashes text[] not null default '{}',
  received integer not null check (received >= 0),
  written integer not null check (written >= 0 and written <= received),
  acknowledged_at timestamptz not null default pg_catalog.now(),
  check ((kind = 'batch' and id <> window_id and received between 1 and 200
          and pg_catalog.cardinality(source_order_hashes) = received)
         or (kind = 'finalize' and id = window_id
             and pg_catalog.cardinality(source_order_hashes) = 0))
);
create table private.duoli_detail_progress (
  platform text not null check (platform in ('UANG','HOT985','IND666','FB168','FB333')),
  business text not null check (business in ('recharge','withdraw')),
  local_day date not null,
  end_exclusive timestamptz not null,
  source_count integer not null check (source_count >= 0),
  uploaded_count integer not null check (uploaded_count = source_count),
  window_id uuid not null,
  finalized boolean not null check (finalized),
  status_coverage text not null check (status_coverage = 'requested_all_unverified'),
  query_mode text not null check (query_mode = 'creation_day_recheck'),
  acknowledged_at timestamptz not null default pg_catalog.now(),
  primary key (platform, business, local_day)
);
create table private.duoli_midnight_snapshots (
  id uuid primary key,
  platform text not null check (platform in ('UANG','HOT985','IND666','FB168','FB333')),
  snapshot_day date not null,
  scheduled_at timestamptz not null,
  capture_started_at timestamptz,
  capture_finished_at timestamptz,
  capture_metadata jsonb,
  status text not null check (status in ('partial','complete','missed')),
  source_count integer check (source_count >= 0),
  uploaded_count integer not null default 0 check (uploaded_count >= 0),
  finalized_body_hash text check (finalized_body_hash ~ '^[0-9a-f]{64}$'),
  query_scope text not null default 'all_dates_status_1_audit_0_all_vip_requested'
    check (query_scope = 'all_dates_status_1_audit_0_all_vip_requested'),
  reason text check (reason = 'offline_or_not_captured'),
  received_at timestamptz not null default pg_catalog.now(),
  unique(platform,snapshot_day),
  check (scheduled_at = snapshot_day::timestamp at time zone 'Asia/Bangkok'),
  check ((capture_metadata is null and capture_started_at is null and capture_finished_at is null
            and status = 'missed')
    or (capture_metadata is not null and capture_started_at is not null and capture_finished_at is not null
      and capture_started_at >= scheduled_at
      and capture_started_at <= scheduled_at + interval '5 minutes'
      and capture_finished_at >= capture_started_at
      and capture_finished_at <= scheduled_at + interval '10 minutes')),
  check ((status = 'complete' and source_count is not null and source_count = uploaded_count and finalized_body_hash is not null
      and reason is null) or (status <> 'complete' and source_count is null and finalized_body_hash is null)),
  check ((status = 'missed') = (reason is not null))
);
create table private.duoli_midnight_rows (
  snapshot_id uuid not null references private.duoli_midnight_snapshots(id),
  source_order_id text not null check (pg_catalog.length(source_order_id) between 1 and 512),
  source_order_hash text not null check (source_order_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  updated_at timestamptz,
  projection jsonb not null check (pg_catalog.jsonb_typeof(projection) = 'object'),
  primary key(snapshot_id,source_order_id),
  unique(snapshot_id,source_order_hash)
);
create table private.duoli_midnight_batches (
  id uuid primary key,
  snapshot_id uuid not null references private.duoli_midnight_snapshots(id),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  source_order_hashes text[] not null,
  received integer not null check (received between 1 and 200),
  written integer not null check (written = received),
  acknowledged_at timestamptz not null default pg_catalog.now(),
  check (pg_catalog.cardinality(source_order_hashes) = received)
);
CREATE OR REPLACE FUNCTION private.duoli_detail_iso(p_value timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select pg_catalog.to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$function$;
REVOKE ALL ON FUNCTION private.duoli_detail_iso(p_value timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.duoli_detail_keys(p_obj jsonb, p_allowed text[], p_exact boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_typeof(p_obj) = 'object'
    and not exists (select 1 from pg_catalog.jsonb_object_keys(p_obj) as k(key)
                    where not (k.key = any (p_allowed)))
    and (not p_exact or p_obj ?& p_allowed)
$function$;
REVOKE ALL ON FUNCTION private.duoli_detail_keys(p_obj jsonb, p_allowed text[], p_exact boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.duoli_detail_timestamp(p_value text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_value timestamptz;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.\d{1,6})?(Z|\+00:00)$' then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  begin v_value := p_value::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end;
  if not pg_catalog.isfinite(v_value) then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  return v_value;
end $function$;
REVOKE ALL ON FUNCTION private.duoli_detail_timestamp(p_value text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.duoli_detail_ingest(p_key text, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb;
  v_action text;
  v_platform text;
  v_business text;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_observed timestamptz;
  v_window uuid;
  v_batch uuid;
  v_hash text;
  v_existing private.duoli_detail_batches%rowtype;
  v_row jsonb;
  v_pair record;
  v_created timestamptz;
  v_updated timestamptz;
  v_source_id text;
  v_source_hash text;
  v_hashes text[] := '{}';
  v_batch_ids uuid[] := '{}';
  v_received integer := 0;
  v_written integer := 0;
  v_row_count integer;
  v_source_count integer;
  v_receipt_count integer;
  v_receipt_rows integer;
  v_distinct_rows integer;
  v_actual_count integer;
  v_matching_count integer;
  v_response jsonb;
  v_row_keys constant text[] := array['order_id','source_order_id','platform','business_type',
    'order_no','member_id','created_at','created_day','updated_at','status_code','status_text',
    'currency','operator','provider','provider_code','channel','amount_raw','amount_source',
    'amount_unit','amount_fields_raw','raw'];
  v_amount_keys constant text[] := array['original_price','gold','amount','order_amount',
    'actual_amount','pay_amount','payment_amount','price','money'];
  v_raw_keys constant text[] := array['_id','order_id','order_no','id','orderId','created_at',
    'create_time','createdAt','createTime','apply_time','applyTime','update_at','update_time',
    'updated_at','updatedAt','updateTime','original_price','gold','amount','order_amount',
    'actual_amount','pay_amount','payment_amount','price','money','status_text','statusText',
    'audit_status_text','auditStatusText','state_text','stateText','user_id','status','currency',
    'pay_chn','channel','channel_code','bank_code','bank_child','e_wallet_type_name','pay_type'];
begin
  if p_key is null or pg_catalog.length(p_key) not between 32 and 256
     or p_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode = '28000', message = 'duoli_unauthorized';
  end if;
  select c.scope into v_scope from private.duoli_detail_credentials c
   where c.active and c.key_hash = pg_catalog.encode(extensions.digest(p_key, 'sha256'), 'hex');
  if v_scope is null then
    raise exception using errcode = '28000', message = 'duoli_unauthorized';
  end if;
  if p_body is null or pg_catalog.jsonb_typeof(p_body) <> 'object'
     or pg_catalog.octet_length(p_body::text) >= 1048576
     or p_body->'schema_version' is distinct from '1'::jsonb
     or pg_catalog.jsonb_typeof(p_body->'action') <> 'string' then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  v_action := p_body->>'action';
  if v_action in ('check','state') then
    if not private.duoli_detail_keys(p_body, array['schema_version','action']) then
      raise exception using errcode = '22023', message = 'duoli_invalid_request';
    end if;
    if v_action = 'check' then
      return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','check',
        'platforms',v_scope->'platforms','receiver_version','DOLI_DETAIL_R1',
        'status_coverage','requested_all_unverified','query_mode','creation_day_recheck');
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'platform',p.platform,'business',p.business,'local_day',p.local_day::text,
      'end_exclusive',private.duoli_detail_iso(p.end_exclusive),'source_count',p.source_count,
      'uploaded_count',p.uploaded_count,'window_id',p.window_id,'finalized',p.finalized,
      'status_coverage',p.status_coverage,'query_mode',p.query_mode,
      'acknowledged_at',private.duoli_detail_iso(p.acknowledged_at))
      order by p.platform,p.business,p.local_day), '[]'::jsonb)
    into v_response from private.duoli_detail_progress p
    where (v_scope->'platforms') ? p.platform;
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','state','progress',v_response);
  end if;
  if v_action = 'batch' then
    if not private.duoli_detail_keys(p_body, array['schema_version','action','window_id','batch_id',
        'platform','business','local_day','end_exclusive','observed_at','rows']) then
      raise exception using errcode = '22023', message = 'duoli_invalid_request';
    end if;
  elsif v_action = 'finalize' then
    if not private.duoli_detail_keys(p_body, array['schema_version','action','window_id',
        'platform','business','local_day','end_exclusive','source_count','batch_ids','proof','status_coverage'])
       or p_body->>'proof' is distinct from 'terminal_double_census'
       or p_body->>'status_coverage' is distinct from 'requested_all_unverified' then
      raise exception using errcode = '22023', message = 'duoli_invalid_request';
    end if;
  else
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  if pg_catalog.jsonb_typeof(p_body->'platform') <> 'string'
     or pg_catalog.jsonb_typeof(p_body->'business') <> 'string'
     or not ((v_scope->'platforms') ? (p_body->>'platform'))
     or p_body->>'business' not in ('recharge','withdraw')
     or pg_catalog.jsonb_typeof(p_body->'local_day') <> 'string'
     or p_body->>'local_day' !~ '^\d{4}-\d{2}-\d{2}$'
     or pg_catalog.jsonb_typeof(p_body->'window_id') <> 'string'
     or p_body->>'window_id' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  v_platform := p_body->>'platform'; v_business := p_body->>'business';
  begin v_day := (p_body->>'local_day')::date; v_window := (p_body->>'window_id')::uuid;
  exception when others then raise exception using errcode = '22023', message = 'duoli_invalid_request'; end;
  v_start := v_day::timestamp at time zone 'Asia/Bangkok';
  v_end := private.duoli_detail_timestamp(p_body->>'end_exclusive');
  if v_end <= v_start or v_end > v_start + interval '1 day' or v_end > pg_catalog.now()
     or pg_catalog.date_trunc('minute',v_end) <> v_end
     or extract(minute from v_end)::integer % 10 <> 0 then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  -- Serialize only this new receiver's window; no pre-existing advisory lock keys.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duoli_detail:' || v_window::text, 0));
  -- Keep count verification stable while another census for this same day commits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'duoli_detail_day:' || v_platform || ':' || v_business || ':' || v_day::text, 0));
  v_hash := pg_catalog.encode(extensions.digest(p_body::text, 'sha256'), 'hex');

  if v_action = 'batch' then
    if pg_catalog.jsonb_typeof(p_body->'batch_id') <> 'string'
       or p_body->>'batch_id' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
       or pg_catalog.jsonb_typeof(p_body->'rows') <> 'array'
       or pg_catalog.jsonb_array_length(p_body->'rows') not between 1 and 200 then
      raise exception using errcode = '22023', message = 'duoli_invalid_request';
    end if;
    v_batch := (p_body->>'batch_id')::uuid;
    if v_batch = v_window then raise exception using errcode = '22023', message = 'duoli_invalid_request'; end if;
    select * into v_existing from private.duoli_detail_batches b where b.id = v_batch;
    if found then
      if v_existing.kind <> 'batch' or v_existing.body_hash <> v_hash
         or v_existing.window_id <> v_window or v_existing.platform <> v_platform
         or v_existing.business <> v_business then
        raise exception using errcode = '23505', message = 'duoli_batch_conflict';
      end if;
      return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','batch',
        'batch_id',v_batch,'window_id',v_window,'received',v_existing.received,
        'written',v_existing.written,'replayed',true);
    end if;
    if exists (select 1 from private.duoli_detail_batches b where b.window_id = v_window
      and (b.kind = 'finalize' or b.platform <> v_platform or b.business <> v_business
        or b.local_day <> v_day or b.end_exclusive <> v_end)) then
      raise exception using errcode = '23505', message = 'duoli_batch_conflict';
    end if;
    v_observed := private.duoli_detail_timestamp(p_body->>'observed_at');
    if v_observed < v_end or v_observed > pg_catalog.now() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'duoli_invalid_request';
    end if;
    for v_row in select r.value from pg_catalog.jsonb_array_elements(p_body->'rows') as r(value) loop
      if not private.duoli_detail_keys(v_row,v_row_keys)
         or v_row->>'platform' is distinct from v_platform or v_row->>'business_type' is distinct from v_business
         or v_row->>'amount_unit' is distinct from 'source_unverified'
         or pg_catalog.jsonb_typeof(v_row->'order_id') <> 'string'
         or pg_catalog.length(v_row->>'order_id') not between 1 and 512
         or pg_catalog.length(pg_catalog.btrim(v_row->>'order_id')) = 0
         or pg_catalog.jsonb_typeof(v_row->'source_order_id') <> 'string'
         or pg_catalog.length(v_row->>'source_order_id') not between 1 and 512
         or pg_catalog.length(pg_catalog.btrim(v_row->>'source_order_id')) = 0
         or v_row->>'created_day' is distinct from v_day::text then
        raise exception using errcode = '22023', message = 'duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row) as e
                    where e.key <> all(array['amount_fields_raw','raw']) loop
        if pg_catalog.jsonb_typeof(v_pair.value) not in ('string','null')
           or (pg_catalog.jsonb_typeof(v_pair.value) = 'string' and
               (pg_catalog.length(v_pair.value #>> '{}') > 512 or (v_pair.value #>> '{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
          raise exception using errcode = '22023', message = 'duoli_invalid_request';
        end if;
      end loop;
      v_created := private.duoli_detail_timestamp(v_row->>'created_at');
      v_updated := case when v_row->'updated_at' = 'null'::jsonb then null
                        else private.duoli_detail_timestamp(v_row->>'updated_at') end;
      if v_created < v_start or v_created >= v_end or (v_updated is not null and v_updated < v_created)
         or (v_row->>'currency' is not null and v_row->>'currency' !~ '^[A-Z0-9]{2,16}$')
         or (v_row->>'amount_raw' is not null and
             (pg_catalog.length(v_row->>'amount_raw') > 128 or v_row->>'amount_raw' !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'))
         or (v_row->>'amount_source' is not null and not (v_row->>'amount_source' = any(v_amount_keys)))
         or ((v_row->>'amount_raw' is null) <> (v_row->>'amount_source' is null)) then
        raise exception using errcode = '22023', message = 'duoli_invalid_request';
      end if;
      if not private.duoli_detail_keys(v_row->'amount_fields_raw',v_amount_keys,false)
         or not private.duoli_detail_keys(v_row->'raw',v_raw_keys,false) then
        raise exception using errcode = '22023', message = 'duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row->'amount_fields_raw') as e loop
        if pg_catalog.jsonb_typeof(v_pair.value) <> 'string'
           or pg_catalog.length(v_pair.value #>> '{}') > 128
           or (v_pair.value #>> '{}') !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
          raise exception using errcode = '22023', message = 'duoli_invalid_request';
        end if;
      end loop;
      if v_row->>'amount_source' is not null
         and (v_row->'amount_fields_raw'->>(v_row->>'amount_source')) is distinct from (v_row->>'amount_raw') then
        raise exception using errcode = '22023', message = 'duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row->'raw') as e loop
        if pg_catalog.jsonb_typeof(v_pair.value) not in ('string','number','boolean')
           or (pg_catalog.jsonb_typeof(v_pair.value) = 'string' and
               (pg_catalog.length(v_pair.value #>> '{}') > 512 or (v_pair.value #>> '{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
          raise exception using errcode = '22023', message = 'duoli_invalid_request';
        end if;
      end loop;
      v_source_id := v_row->>'source_order_id';
      v_source_hash := pg_catalog.encode(extensions.digest(v_source_id,'sha256'),'hex');
      if v_source_hash = any(v_hashes) or exists (select 1 from private.duoli_detail_batches b
          where b.window_id = v_window and b.kind = 'batch' and v_source_hash = any(b.source_order_hashes)) then
        raise exception using errcode = '23505', message = 'duoli_batch_conflict';
      end if;
      v_hashes := pg_catalog.array_append(v_hashes,v_source_hash);
      if exists (select 1 from private.duoli_order_details d where d.platform = v_platform
         and d.business = v_business and d.source_order_id = v_source_id and d.created_at <> v_created) then
        raise exception using errcode = '23505', message = 'duoli_batch_conflict';
      end if;
      insert into private.duoli_order_details as d (platform,business,source_order_id,source_order_hash,
        order_id,order_no,member_id,created_at,created_day,updated_at,status_code,status_text,currency,
        operator,provider,provider_code,channel,amount_raw,amount_source,amount_unit,amount_fields_raw,
        raw_projection,observed_at)
      values (v_platform,v_business,v_source_id,v_source_hash,v_row->>'order_id',v_row->>'order_no',
        v_row->>'member_id',v_created,v_day,v_updated,v_row->>'status_code',v_row->>'status_text',
        v_row->>'currency',v_row->>'operator',v_row->>'provider',v_row->>'provider_code',v_row->>'channel',
        v_row->>'amount_raw',v_row->>'amount_source','source_unverified',v_row->'amount_fields_raw',
        v_row->'raw',v_observed)
      on conflict (platform,business,source_order_id) do update set
        order_id = excluded.order_id,order_no = excluded.order_no,member_id = excluded.member_id,
        updated_at = excluded.updated_at,status_code = excluded.status_code,status_text = excluded.status_text,
        currency = excluded.currency,operator = excluded.operator,provider = excluded.provider,
        provider_code = excluded.provider_code,channel = excluded.channel,amount_raw = excluded.amount_raw,
        amount_source = excluded.amount_source,amount_fields_raw = excluded.amount_fields_raw,
        raw_projection = excluded.raw_projection,observed_at = excluded.observed_at,received_at = pg_catalog.now()
      where excluded.observed_at >= d.observed_at
        and (d.updated_at is null or (excluded.updated_at is not null and excluded.updated_at >= d.updated_at));
      get diagnostics v_row_count = row_count;
      v_written := v_written + v_row_count; v_received := v_received + 1;
    end loop;
    insert into private.duoli_detail_batches(id,kind,window_id,platform,business,local_day,
      end_exclusive,observed_at,body_hash,source_order_hashes,received,written)
    values (v_batch,'batch',v_window,v_platform,v_business,v_day,v_end,v_observed,v_hash,v_hashes,v_received,v_written);
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','batch','batch_id',v_batch,
      'window_id',v_window,'received',v_received,'written',v_written,'replayed',false);
  end if;

  select * into v_existing from private.duoli_detail_batches b where b.id = v_window;
  if found then
    if v_existing.kind <> 'finalize' or v_existing.window_id <> v_window
       or v_existing.platform <> v_platform or v_existing.business <> v_business
       or v_existing.body_hash <> v_hash then
      raise exception using errcode = '23505', message = 'duoli_batch_conflict';
    end if;
    v_source_count := v_existing.received;
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','finalize',
      'window_id',v_window,'platform',v_platform,'business',v_business,'local_day',v_day::text,
      'end_exclusive',p_body->>'end_exclusive','source_count',v_source_count,
      'uploaded_count',v_source_count,'finalized',true,'status_coverage','requested_all_unverified',
      'query_mode','creation_day_recheck');
  end if;
  if pg_catalog.jsonb_typeof(p_body->'source_count') <> 'number'
     or p_body->>'source_count' !~ '^(0|[1-9][0-9]{0,8})$'
     or pg_catalog.jsonb_typeof(p_body->'batch_ids') <> 'array' then
    raise exception using errcode = '22023', message = 'duoli_invalid_request';
  end if;
  v_source_count := (p_body->>'source_count')::integer;
  for v_row in select r.value from pg_catalog.jsonb_array_elements(p_body->'batch_ids') as r(value) loop
    if pg_catalog.jsonb_typeof(v_row) <> 'string'
       or v_row #>> '{}' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
       or (v_row #>> '{}')::uuid = any(v_batch_ids) then
      raise exception using errcode = '22023', message = 'duoli_invalid_request';
    end if;
    v_batch_ids := pg_catalog.array_append(v_batch_ids,(v_row #>> '{}')::uuid);
  end loop;
  if exists (select 1 from private.duoli_detail_batches b where b.window_id = v_window and
      (b.kind <> 'batch' or b.platform <> v_platform or b.business <> v_business
       or b.local_day <> v_day or b.end_exclusive <> v_end)) then
    raise exception using errcode = '23505', message = 'duoli_batch_conflict';
  end if;
  select pg_catalog.count(*)::integer,coalesce(pg_catalog.sum(b.received),0)::integer
    into v_receipt_count,v_receipt_rows from private.duoli_detail_batches b
    where b.kind = 'batch' and b.window_id = v_window and b.id = any(v_batch_ids)
      and b.platform = v_platform and b.business = v_business and b.local_day = v_day and b.end_exclusive = v_end;
  if v_receipt_count <> pg_catalog.cardinality(v_batch_ids)
     or v_receipt_count <> (select pg_catalog.count(*) from private.duoli_detail_batches b
                           where b.kind = 'batch' and b.window_id = v_window)
     or v_receipt_rows <> v_source_count then
    raise exception using errcode = '23514', message = 'duoli_proof_mismatch';
  end if;
  select pg_catalog.count(distinct h.order_hash)::integer into v_distinct_rows
    from private.duoli_detail_batches b
    cross join lateral pg_catalog.unnest(b.source_order_hashes) as h(order_hash)
    where b.kind = 'batch' and b.window_id = v_window;
  select pg_catalog.count(*)::integer into v_actual_count from private.duoli_order_details d
    where d.platform = v_platform and d.business = v_business and d.created_at >= v_start and d.created_at < v_end;
  select pg_catalog.count(*)::integer into v_matching_count from private.duoli_order_details d
    where d.platform = v_platform and d.business = v_business and d.created_at >= v_start and d.created_at < v_end
      and exists (select 1 from private.duoli_detail_batches b
                  where b.kind = 'batch' and b.window_id = v_window and d.source_order_hash = any(b.source_order_hashes));
  if v_distinct_rows <> v_source_count or v_actual_count <> v_source_count or v_matching_count <> v_source_count then
    raise exception using errcode = '23514', message = 'duoli_proof_mismatch';
  end if;
  -- The client attests terminal pagination plus two matching ID censuses.
  -- This proves receipt/count consistency; all-status source semantics remain unverified.
  insert into private.duoli_detail_batches(id,kind,window_id,platform,business,local_day,
    end_exclusive,body_hash,received,written)
    values (v_window,'finalize',v_window,v_platform,v_business,v_day,v_end,v_hash,v_source_count,v_source_count);
  insert into private.duoli_detail_progress as p (platform,business,local_day,end_exclusive,
    source_count,uploaded_count,window_id,finalized,status_coverage,query_mode)
    values (v_platform,v_business,v_day,v_end,v_source_count,v_source_count,v_window,true,
      'requested_all_unverified','creation_day_recheck')
    on conflict (platform,business,local_day) do update set
      end_exclusive = excluded.end_exclusive,source_count = excluded.source_count,
      uploaded_count = excluded.uploaded_count,window_id = excluded.window_id,
      finalized = true,status_coverage = excluded.status_coverage,query_mode = excluded.query_mode,
      acknowledged_at = pg_catalog.now()
    where excluded.end_exclusive >= p.end_exclusive;
  return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','finalize',
    'window_id',v_window,'platform',v_platform,'business',v_business,'local_day',v_day::text,
    'end_exclusive',p_body->>'end_exclusive','source_count',v_source_count,
    'uploaded_count',v_source_count,'finalized',true,'status_coverage','requested_all_unverified',
    'query_mode','creation_day_recheck');
end $function$;
REVOKE ALL ON FUNCTION public.duoli_detail_ingest(p_key text, p_body jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.duoli_detail_ingest(p_key text, p_body jsonb) TO "service_role";
CREATE OR REPLACE FUNCTION public.duoli_detail_ingest_v2(p_key text, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb; v_action text; v_platform text; v_business text; v_stream text;
  v_start timestamptz; v_end timestamptz; v_observed timestamptz;
  v_window uuid; v_batch uuid; v_body_hash text;
  v_existing private.duoli_detail_batches_v2%rowtype;
  v_progress private.duoli_detail_progress_v2%rowtype;
  v_row jsonb; v_pair record; v_created timestamptz; v_updated timestamptz;
  v_event timestamptz; v_audit timestamptz; v_duration bigint; v_created_day date;
  v_source_id text; v_source_hash text; v_hashes text[] := '{}';
  v_batch_ids uuid[] := '{}'; v_received integer := 0; v_written integer := 0;
  v_row_count integer; v_source_count integer; v_receipt_count integer;
  v_receipt_rows integer; v_distinct_rows integer; v_matching_count integer;
  v_result jsonb;
  v_row_keys constant text[] := array['order_id','source_order_id','platform','business_type',
    'order_no','member_id','created_at','created_day','updated_at','status_code','status_text',
    'currency','operator','provider','provider_code','channel','amount_raw','amount_source',
    'amount_unit','amount_fields_raw','raw','audit_completed_at','audit_duration_seconds'];
  v_amount_keys constant text[] := array['original_price','gold','amount','order_amount',
    'actual_amount','pay_amount','payment_amount','price','money','gamount',
    'actual_received_gamount','fee','fee_gamount'];
  v_raw_keys constant text[] := array['_id','order_id','order_no','id','orderId','created_at',
    'create_time','createdAt','createTime','apply_time','applyTime','update_at','update_time',
    'updated_at','updatedAt','updateTime','original_price','gold','amount','order_amount',
    'actual_amount','pay_amount','payment_amount','price','money','status_text','statusText',
    'audit_status_text','auditStatusText','state_text','stateText','user_id','status','currency',
    'pay_chn','channel','channel_code','bank_code','bank_child','e_wallet_type_name','pay_type',
    'audit_time','audit_time_consuming','gamount','actual_received_gamount','fee','fee_gamount'];
begin
  if p_key is null or pg_catalog.length(p_key) not between 32 and 256
     or p_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode='28000',message='duoli_unauthorized';
  end if;
  select c.scope into v_scope from private.duoli_detail_credentials c
   where c.active and c.key_hash=pg_catalog.encode(extensions.digest(p_key,'sha256'),'hex');
  if v_scope is null then raise exception using errcode='28000',message='duoli_unauthorized'; end if;
  if p_body is null or pg_catalog.jsonb_typeof(p_body)<>'object'
     or pg_catalog.octet_length(p_body::text)>=1048576
     or p_body->'schema_version' is distinct from '2'::jsonb
     or pg_catalog.jsonb_typeof(p_body->'action')<>'string' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_action:=p_body->>'action';
  if v_action in ('check','state') then
    if not private.duoli_detail_keys(p_body,array['schema_version','action']) then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    if v_action='check' then
      return pg_catalog.jsonb_build_object('ok',true,'schema_version',2,'action','check',
        'platforms',v_scope->'platforms','receiver_version','DOLI_DETAIL_R2',
        'status_coverage','requested_all_unverified','query_mode','source_time_stream');
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'platform',p.platform,'business',p.business,'stream',p.stream,
      'start_at',private.duoli_detail_iso(p.start_at),'end_exclusive',private.duoli_detail_iso(p.end_exclusive),
      'source_count',p.source_count,'uploaded_count',p.uploaded_count,'window_id',p.window_id,
      'finalized',p.finalized,'status_coverage',p.status_coverage,'query_mode',p.query_mode,
      'acknowledged_at',private.duoli_detail_iso(p.acknowledged_at))
      order by p.platform,p.business,p.stream),'[]'::jsonb) into v_result
      from private.duoli_detail_progress_v2 p where (v_scope->'platforms') ? p.platform;
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',2,'action','state','progress',v_result);
  elsif v_action='batch' then
    if not private.duoli_detail_keys(p_body,array['schema_version','action','window_id','batch_id',
      'platform','business','stream','start_at','end_exclusive','observed_at','rows']) then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
  elsif v_action='finalize' then
    if not private.duoli_detail_keys(p_body,array['schema_version','action','window_id',
      'platform','business','stream','start_at','end_exclusive','source_count','batch_ids','proof','status_coverage'])
      or p_body->>'proof' is distinct from 'terminal_double_census'
      or p_body->>'status_coverage' is distinct from 'requested_all_unverified' then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
  else raise exception using errcode='22023',message='duoli_invalid_request'; end if;

  if pg_catalog.jsonb_typeof(p_body->'platform')<>'string'
     or not ((v_scope->'platforms') ? (p_body->>'platform'))
     or pg_catalog.jsonb_typeof(p_body->'business')<>'string'
     or p_body->>'business' not in ('recharge','withdraw')
     or pg_catalog.jsonb_typeof(p_body->'stream')<>'string'
     or p_body->>'stream' not in ('created','updated')
     or (p_body->>'stream'='created' and p_body->>'business'<>'recharge')
     or pg_catalog.jsonb_typeof(p_body->'window_id')<>'string'
     or p_body->>'window_id' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_platform:=p_body->>'platform';v_business:=p_body->>'business';v_stream:=p_body->>'stream';
  v_window:=(p_body->>'window_id')::uuid;
  v_start:=private.duoli_detail_timestamp(p_body->>'start_at');
  v_end:=private.duoli_detail_timestamp(p_body->>'end_exclusive');
  if v_end<=v_start or v_end-v_start>interval '1 day' or v_end>pg_catalog.now()
     or pg_catalog.date_trunc('minute',v_start)<>v_start
     or pg_catalog.date_trunc('minute',v_end)<>v_end
     or extract(minute from v_start)::integer % 10<>0
     or extract(minute from v_end)::integer % 10<>0 then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duoli_detail_v2:'||v_window::text,0));
  -- Both R2 streams share latest order rows; serialize writes and proof commits within this receiver.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'duoli_detail_v2_rows:'||v_platform||':'||v_business,0));
  v_body_hash:=pg_catalog.encode(extensions.digest(p_body::text,'sha256'),'hex');

  if v_action='batch' then
    if pg_catalog.jsonb_typeof(p_body->'batch_id')<>'string'
       or p_body->>'batch_id' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
       or pg_catalog.jsonb_typeof(p_body->'rows')<>'array'
       or pg_catalog.jsonb_array_length(p_body->'rows') not between 1 and 200 then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    v_batch:=(p_body->>'batch_id')::uuid;
    if v_batch=v_window then raise exception using errcode='22023',message='duoli_invalid_request'; end if;
    select * into v_existing from private.duoli_detail_batches_v2 b where b.id=v_batch;
    if found then
      if v_existing.kind<>'batch' or v_existing.body_hash<>v_body_hash
         or v_existing.window_id<>v_window or v_existing.platform<>v_platform
         or v_existing.business<>v_business or v_existing.stream<>v_stream then
        raise exception using errcode='23505',message='duoli_batch_conflict';
      end if;
      return pg_catalog.jsonb_build_object('ok',true,'schema_version',2,'action','batch',
        'batch_id',v_batch,'window_id',v_window,'platform',v_platform,'business',v_business,'stream',v_stream,
        'start_at',p_body->>'start_at','end_exclusive',p_body->>'end_exclusive',
        'received',v_existing.received,'written',v_existing.written,'replayed',true,
        'status_coverage','requested_all_unverified','query_mode','source_time_stream');
    end if;
    if exists(select 1 from private.duoli_detail_batches_v2 b where b.window_id=v_window
      and (b.kind='finalize' or b.platform<>v_platform or b.business<>v_business or b.stream<>v_stream
        or b.start_at<>v_start or b.end_exclusive<>v_end)) then
      raise exception using errcode='23505',message='duoli_batch_conflict';
    end if;
    v_observed:=private.duoli_detail_timestamp(p_body->>'observed_at');
    if v_observed<v_end or v_observed>pg_catalog.now()+interval '5 minutes' then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    for v_row in select r.value from pg_catalog.jsonb_array_elements(p_body->'rows') r(value) loop
      if not private.duoli_detail_keys(v_row,v_row_keys)
         or v_row->>'platform' is distinct from v_platform or v_row->>'business_type' is distinct from v_business
         or v_row->>'amount_unit' is distinct from 'source_unverified'
         or pg_catalog.jsonb_typeof(v_row->'order_id')<>'string'
         or pg_catalog.length(v_row->>'order_id') not between 1 and 512
         or pg_catalog.length(pg_catalog.btrim(v_row->>'order_id'))=0
         or pg_catalog.jsonb_typeof(v_row->'source_order_id')<>'string'
         or pg_catalog.length(v_row->>'source_order_id') not between 1 and 512
         or pg_catalog.length(pg_catalog.btrim(v_row->>'source_order_id'))=0 then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row) e
        where e.key<>all(array['amount_fields_raw','raw','audit_duration_seconds']) loop
        if pg_catalog.jsonb_typeof(v_pair.value) not in ('string','null')
           or (pg_catalog.jsonb_typeof(v_pair.value)='string' and
               (pg_catalog.length(v_pair.value #>> '{}')>512 or (v_pair.value #>> '{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
      end loop;
      v_created:=private.duoli_detail_timestamp(v_row->>'created_at');
      v_created_day:=(v_created at time zone 'Asia/Bangkok')::date;
      v_updated:=case when v_row->'updated_at'='null'::jsonb then null
        else private.duoli_detail_timestamp(v_row->>'updated_at') end;
      v_audit:=case when v_row->'audit_completed_at'='null'::jsonb then null
        else private.duoli_detail_timestamp(v_row->>'audit_completed_at') end;
      v_duration:=null;
      if v_row->'audit_duration_seconds'<>'null'::jsonb then
        if pg_catalog.jsonb_typeof(v_row->'audit_duration_seconds')<>'number'
           or v_row->>'audit_duration_seconds' !~ '^(0|[1-9][0-9]{0,15})$'
           or (v_row->>'audit_duration_seconds')::numeric>9007199254740991 then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
        v_duration:=(v_row->>'audit_duration_seconds')::bigint;
      end if;
      v_event:=case when v_stream='created' then v_created else v_updated end;
      if v_event is null or v_event<v_start or v_event>=v_end
         or v_row->>'created_day' is distinct from v_created_day::text
         or (v_updated is not null and v_updated<v_created)
         or (v_audit is not null and v_audit<v_created)
         or v_created>v_observed
         or (v_row->>'currency' is not null and v_row->>'currency' !~ '^[A-Z0-9]{2,16}$')
         or (v_row->>'amount_raw' is not null and
          (pg_catalog.length(v_row->>'amount_raw')>128 or v_row->>'amount_raw' !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'))
         or (v_row->>'amount_source' is not null and not (v_row->>'amount_source'=any(v_amount_keys)))
         or ((v_row->>'amount_raw' is null)<>(v_row->>'amount_source' is null)) then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      if not private.duoli_detail_keys(v_row->'amount_fields_raw',v_amount_keys,false)
         or not private.duoli_detail_keys(v_row->'raw',v_raw_keys,false) then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row->'amount_fields_raw') e loop
        if pg_catalog.jsonb_typeof(v_pair.value)<>'string' or pg_catalog.length(v_pair.value #>> '{}')>128
           or (v_pair.value #>> '{}') !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
      end loop;
      if v_row->>'amount_source' is not null and
        (v_row->'amount_fields_raw'->>(v_row->>'amount_source')) is distinct from (v_row->>'amount_raw') then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row->'raw') e loop
        if pg_catalog.jsonb_typeof(v_pair.value) not in ('string','number','boolean')
          or (pg_catalog.jsonb_typeof(v_pair.value)='string' and
            (pg_catalog.length(v_pair.value #>> '{}')>512 or (v_pair.value #>> '{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
      end loop;
      v_source_id:=v_row->>'source_order_id';
      v_source_hash:=pg_catalog.encode(extensions.digest(v_source_id,'sha256'),'hex');
      if v_source_hash=any(v_hashes) or exists(select 1 from private.duoli_detail_batches_v2 b
        where b.kind='batch' and b.window_id=v_window and v_source_hash=any(b.source_order_hashes)) then
        raise exception using errcode='23505',message='duoli_batch_conflict';
      end if;
      v_hashes:=pg_catalog.array_append(v_hashes,v_source_hash);
      insert into private.duoli_order_details as d(platform,business,source_order_id,source_order_hash,
        order_id,order_no,member_id,created_at,created_day,updated_at,status_code,status_text,currency,
        operator,provider,provider_code,channel,amount_raw,amount_source,amount_unit,amount_fields_raw,
        raw_projection,observed_at,audit_completed_at,audit_duration_seconds)
      values(v_platform,v_business,v_source_id,v_source_hash,v_row->>'order_id',v_row->>'order_no',
        v_row->>'member_id',v_created,v_created_day,v_updated,v_row->>'status_code',v_row->>'status_text',
        v_row->>'currency',v_row->>'operator',v_row->>'provider',v_row->>'provider_code',v_row->>'channel',
        v_row->>'amount_raw',v_row->>'amount_source','source_unverified',v_row->'amount_fields_raw',
        v_row->'raw',v_observed,v_audit,v_duration)
      on conflict(platform,business,source_order_id) do update set
        order_id=excluded.order_id,order_no=excluded.order_no,member_id=excluded.member_id,
        updated_at=excluded.updated_at,status_code=excluded.status_code,status_text=excluded.status_text,
        currency=excluded.currency,operator=excluded.operator,provider=excluded.provider,
        provider_code=excluded.provider_code,channel=excluded.channel,amount_raw=excluded.amount_raw,
        amount_source=excluded.amount_source,amount_fields_raw=excluded.amount_fields_raw,
        raw_projection=excluded.raw_projection,observed_at=excluded.observed_at,received_at=pg_catalog.now(),
        audit_completed_at=coalesce(excluded.audit_completed_at,d.audit_completed_at),
        audit_duration_seconds=coalesce(excluded.audit_duration_seconds,d.audit_duration_seconds)
      where d.created_at=excluded.created_at and excluded.observed_at>=d.observed_at
        and (d.updated_at is null or (excluded.updated_at is not null and excluded.updated_at>=d.updated_at));
      get diagnostics v_row_count=row_count;
      if exists(select 1 from private.duoli_order_details d where d.platform=v_platform and d.business=v_business
        and d.source_order_id=v_source_id and d.created_at<>v_created) then
        raise exception using errcode='23505',message='duoli_batch_conflict';
      end if;
      v_received:=v_received+1;v_written:=v_written+v_row_count;
    end loop;
    insert into private.duoli_detail_batches_v2(id,kind,window_id,platform,business,stream,
      start_at,end_exclusive,observed_at,body_hash,source_order_hashes,received,written)
      values(v_batch,'batch',v_window,v_platform,v_business,v_stream,v_start,v_end,
        v_observed,v_body_hash,v_hashes,v_received,v_written);
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',2,'action','batch',
      'batch_id',v_batch,'window_id',v_window,'platform',v_platform,'business',v_business,'stream',v_stream,
      'start_at',p_body->>'start_at','end_exclusive',p_body->>'end_exclusive','received',v_received,
      'written',v_written,'replayed',false,'status_coverage','requested_all_unverified','query_mode','source_time_stream');
  end if;

  select * into v_existing from private.duoli_detail_batches_v2 b where b.id=v_window;
  if found then
    if v_existing.kind<>'finalize' or v_existing.body_hash<>v_body_hash
      or v_existing.window_id<>v_window or v_existing.platform<>v_platform
      or v_existing.business<>v_business or v_existing.stream<>v_stream then
      raise exception using errcode='23505',message='duoli_batch_conflict';
    end if;
    v_source_count:=v_existing.received;
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',2,'action','finalize',
      'window_id',v_window,'platform',v_platform,'business',v_business,'stream',v_stream,
      'start_at',p_body->>'start_at','end_exclusive',p_body->>'end_exclusive','source_count',v_source_count,
      'uploaded_count',v_source_count,'finalized',true,'status_coverage','requested_all_unverified','query_mode','source_time_stream');
  end if;
  if pg_catalog.jsonb_typeof(p_body->'source_count')<>'number'
    or p_body->>'source_count' !~ '^(0|[1-9][0-9]{0,8})$'
    or pg_catalog.jsonb_typeof(p_body->'batch_ids')<>'array' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_source_count:=(p_body->>'source_count')::integer;
  for v_row in select r.value from pg_catalog.jsonb_array_elements(p_body->'batch_ids') r(value) loop
    if pg_catalog.jsonb_typeof(v_row)<>'string'
      or v_row #>> '{}' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      or (v_row #>> '{}')::uuid=any(v_batch_ids) then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    v_batch_ids:=pg_catalog.array_append(v_batch_ids,(v_row #>> '{}')::uuid);
  end loop;
  if exists(select 1 from private.duoli_detail_batches_v2 b where b.window_id=v_window and
    (b.kind<>'batch' or b.platform<>v_platform or b.business<>v_business or b.stream<>v_stream
      or b.start_at<>v_start or b.end_exclusive<>v_end)) then
    raise exception using errcode='23505',message='duoli_batch_conflict';
  end if;
  select pg_catalog.count(*)::integer,coalesce(pg_catalog.sum(b.received),0)::integer
    into v_receipt_count,v_receipt_rows from private.duoli_detail_batches_v2 b
    where b.kind='batch' and b.window_id=v_window and b.id=any(v_batch_ids)
      and b.platform=v_platform and b.business=v_business and b.stream=v_stream
      and b.start_at=v_start and b.end_exclusive=v_end;
  if v_receipt_count<>pg_catalog.cardinality(v_batch_ids)
    or v_receipt_count<>(select pg_catalog.count(*) from private.duoli_detail_batches_v2 b where b.kind='batch' and b.window_id=v_window)
    or v_receipt_rows<>v_source_count then
    raise exception using errcode='23514',message='duoli_proof_mismatch';
  end if;
  select pg_catalog.count(distinct h.order_hash)::integer into v_distinct_rows
    from private.duoli_detail_batches_v2 b cross join lateral pg_catalog.unnest(b.source_order_hashes) h(order_hash)
    where b.kind='batch' and b.window_id=v_window;
  -- Membership was timestamp-validated when each receipt committed. An order may now have
  -- a newer updated_at outside this old window; only identity presence is checked here.
  select pg_catalog.count(distinct d.source_order_hash)::integer into v_matching_count
    from private.duoli_detail_batches_v2 b
    cross join lateral pg_catalog.unnest(b.source_order_hashes) h(order_hash)
    join private.duoli_order_details d on d.platform=v_platform and d.business=v_business
      and d.source_order_hash=h.order_hash
    where b.kind='batch' and b.window_id=v_window;
  if v_distinct_rows<>v_source_count or v_matching_count<>v_source_count then
    raise exception using errcode='23514',message='duoli_proof_mismatch';
  end if;
  select * into v_progress from private.duoli_detail_progress_v2 p
    where p.platform=v_platform and p.business=v_business and p.stream=v_stream for update;
  if found and (v_start>v_progress.end_exclusive or v_end<v_progress.start_at) then
    raise exception using errcode='23514',message='duoli_progress_gap';
  end if;
  insert into private.duoli_detail_batches_v2(id,kind,window_id,platform,business,stream,
    start_at,end_exclusive,body_hash,received,written)
    values(v_window,'finalize',v_window,v_platform,v_business,v_stream,v_start,v_end,
      v_body_hash,v_source_count,v_source_count);
  insert into private.duoli_detail_progress_v2 as p(platform,business,stream,start_at,end_exclusive,
    source_count,uploaded_count,window_id,finalized,status_coverage,query_mode)
    values(v_platform,v_business,v_stream,v_start,v_end,v_source_count,v_source_count,v_window,true,
      'requested_all_unverified','source_time_stream')
    on conflict(platform,business,stream) do update set
      start_at=least(p.start_at,excluded.start_at),end_exclusive=greatest(p.end_exclusive,excluded.end_exclusive),
      source_count=case when excluded.end_exclusive>=p.end_exclusive then excluded.source_count else p.source_count end,
      uploaded_count=case when excluded.end_exclusive>=p.end_exclusive then excluded.uploaded_count else p.uploaded_count end,
      window_id=case when excluded.end_exclusive>=p.end_exclusive then excluded.window_id else p.window_id end,
      acknowledged_at=pg_catalog.now();
  return pg_catalog.jsonb_build_object('ok',true,'schema_version',2,'action','finalize',
    'window_id',v_window,'platform',v_platform,'business',v_business,'stream',v_stream,
    'start_at',p_body->>'start_at','end_exclusive',p_body->>'end_exclusive','source_count',v_source_count,
    'uploaded_count',v_source_count,'finalized',true,'status_coverage','requested_all_unverified','query_mode','source_time_stream');
end $function$;
REVOKE ALL ON FUNCTION public.duoli_detail_ingest_v2(p_key text, p_body jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.duoli_detail_ingest_v2(p_key text, p_body jsonb) TO "service_role";
CREATE OR REPLACE FUNCTION public.duoli_midnight_ingest(p_key text, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb; v_action text; v_platform text; v_day date;
  v_scheduled timestamptz; v_started timestamptz; v_finished timestamptz;
  v_snapshot uuid; v_batch uuid; v_metadata jsonb; v_body_hash text;
  v_existing private.duoli_midnight_snapshots%rowtype;
  v_receipt private.duoli_midnight_batches%rowtype;
  v_row jsonb; v_pair record; v_created timestamptz; v_updated timestamptz; v_audit timestamptz;
  v_source_id text; v_source_hash text; v_hashes text[] := '{}'; v_batch_ids uuid[] := '{}';
  v_received integer := 0; v_source_count integer; v_receipt_count integer;
  v_receipt_rows integer; v_distinct_rows integer; v_matching_count integer;
  v_result jsonb; v_ack jsonb;
  v_query_scope constant text := 'all_dates_status_1_audit_0_all_vip_requested';
  v_common_keys constant text[] := array['schema_version','action','snapshot_id','platform',
    'snapshot_day','scheduled_at','capture_started_at','capture_finished_at','query_scope'];
  v_row_keys constant text[] := array['order_id','source_order_id','platform','business_type',
    'order_no','member_id','created_at','created_day','updated_at','status_code','status_text',
    'currency','operator','provider','provider_code','channel','amount_raw','amount_source',
    'amount_unit','amount_fields_raw','raw','audit_completed_at','audit_duration_seconds'];
  v_amount_keys constant text[] := array['original_price','gold','amount','order_amount',
    'actual_amount','pay_amount','payment_amount','price','money','gamount',
    'actual_received_gamount','fee','fee_gamount'];
  v_raw_keys constant text[] := array['_id','order_id','order_no','id','orderId','created_at',
    'create_time','createdAt','createTime','apply_time','applyTime','update_at','update_time',
    'updated_at','updatedAt','updateTime','original_price','gold','amount','order_amount',
    'actual_amount','pay_amount','payment_amount','price','money','status_text','statusText',
    'audit_status_text','auditStatusText','state_text','stateText','user_id','status','currency',
    'pay_chn','channel','channel_code','bank_code','bank_child','e_wallet_type_name','pay_type',
    'audit_time','audit_time_consuming','gamount','actual_received_gamount','fee','fee_gamount'];
begin
  if p_key is null or pg_catalog.length(p_key) not between 32 and 256
    or p_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode='28000',message='duoli_unauthorized';
  end if;
  select c.scope into v_scope from private.duoli_detail_credentials c
    where c.active and c.key_hash=pg_catalog.encode(extensions.digest(p_key,'sha256'),'hex');
  if v_scope is null or v_scope->>'system' is distinct from 'DOLI'
    or v_scope->>'country' is distinct from 'ID' then
    raise exception using errcode='28000',message='duoli_unauthorized';
  end if;
  if p_body is null or pg_catalog.jsonb_typeof(p_body)<>'object'
    or pg_catalog.octet_length(p_body::text)>=1048576
    or p_body->'schema_version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_body->'action')<>'string' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_action:=p_body->>'action';
  if v_action in ('check','state') then
    if not private.duoli_detail_keys(p_body,array['schema_version','action']) then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    if v_action='check' then
      return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','check',
        'receiver_version','DOLI_MIDNIGHT_R1','platforms',v_scope->'platforms','query_scope',v_query_scope);
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'snapshot_id',s.id,'platform',s.platform,'snapshot_day',s.snapshot_day,
      'scheduled_at',private.duoli_detail_iso(s.scheduled_at),
      'capture_started_at',private.duoli_detail_iso(s.capture_started_at),
      'capture_finished_at',private.duoli_detail_iso(s.capture_finished_at),
      'status',s.status,'source_count',s.source_count,'uploaded_count',s.uploaded_count,
      'query_scope',s.query_scope,'reason',s.reason) order by s.platform),'[]'::jsonb) into v_result
    from (select distinct on (d.platform) d.* from private.duoli_midnight_snapshots d
      where (v_scope->'platforms') ? d.platform order by d.platform,d.snapshot_day desc) s;
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','state','snapshots',v_result);
  elsif v_action='batch' then
    if not private.duoli_detail_keys(p_body,v_common_keys||array['batch_id','rows'])
      or p_body->>'query_scope' is distinct from v_query_scope then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
  elsif v_action='finalize' then
    if not private.duoli_detail_keys(p_body,v_common_keys||array['source_count','batch_ids','proof'])
      or p_body->>'proof' is distinct from 'terminal_double_census'
      or p_body->>'query_scope' is distinct from v_query_scope then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
  elsif v_action='missed' then
    if not private.duoli_detail_keys(p_body,array['schema_version','action','platform',
      'snapshot_day','scheduled_at','reason'])
      or p_body->>'reason' is distinct from 'offline_or_not_captured' then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
  else raise exception using errcode='22023',message='duoli_invalid_request'; end if;
  if pg_catalog.jsonb_typeof(p_body->'platform')<>'string'
    or not ((v_scope->'platforms') ? (p_body->>'platform'))
    or p_body->>'platform' not in ('UANG','HOT985','IND666','FB168','FB333')
    or pg_catalog.jsonb_typeof(p_body->'snapshot_day')<>'string'
    or p_body->>'snapshot_day' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or pg_catalog.jsonb_typeof(p_body->'scheduled_at')<>'string' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_platform:=p_body->>'platform';
  begin v_day:=(p_body->>'snapshot_day')::date;
  exception when others then raise exception using errcode='22023',message='duoli_invalid_request'; end;
  v_scheduled:=private.duoli_detail_timestamp(p_body->>'scheduled_at');
  if v_scheduled<>(v_day::timestamp at time zone 'Asia/Bangkok') then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'duoli_midnight_slot:'||v_platform||':'||v_day::text,0));
  select * into v_existing from private.duoli_midnight_snapshots s
    where s.platform=v_platform and s.snapshot_day=v_day;
  if v_action='missed' then
    if v_scheduled>pg_catalog.now() then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    if v_existing.id is null then
      insert into private.duoli_midnight_snapshots(id,platform,snapshot_day,scheduled_at,status,reason)
        values(pg_catalog.gen_random_uuid(),v_platform,v_day,v_scheduled,'missed','offline_or_not_captured')
        returning * into v_existing;
    elsif v_existing.status<>'complete' then
      update private.duoli_midnight_snapshots s set status='missed',reason='offline_or_not_captured'
        where s.id=v_existing.id returning * into v_existing;
    end if;
    return pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action','missed',
      'snapshot_id',v_existing.id,'platform',v_platform,'snapshot_day',p_body->>'snapshot_day',
      'scheduled_at',p_body->>'scheduled_at','reason','offline_or_not_captured',
      'status',v_existing.status,'query_scope',v_query_scope);
  end if;
  if pg_catalog.jsonb_typeof(p_body->'snapshot_id')<>'string'
    or p_body->>'snapshot_id' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    or pg_catalog.jsonb_typeof(p_body->'capture_started_at')<>'string'
    or pg_catalog.jsonb_typeof(p_body->'capture_finished_at')<>'string' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_snapshot:=(p_body->>'snapshot_id')::uuid;
  v_started:=private.duoli_detail_timestamp(p_body->>'capture_started_at');
  v_finished:=private.duoli_detail_timestamp(p_body->>'capture_finished_at');
  if v_started<v_scheduled or v_started>v_scheduled+interval '5 minutes'
    or v_finished<v_started or v_finished>v_scheduled+interval '10 minutes'
    or v_finished>pg_catalog.now()+interval '120 seconds' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_metadata:=pg_catalog.jsonb_build_object('snapshot_id',p_body->>'snapshot_id','platform',v_platform,
    'snapshot_day',p_body->>'snapshot_day','scheduled_at',p_body->>'scheduled_at',
    'capture_started_at',p_body->>'capture_started_at','capture_finished_at',p_body->>'capture_finished_at');
  v_ack:=v_metadata||pg_catalog.jsonb_build_object('ok',true,'schema_version',1,'action',v_action,'query_scope',v_query_scope);
  v_body_hash:=pg_catalog.encode(extensions.digest(p_body::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duoli_midnight_id:'||v_snapshot::text,0));
  if v_existing.id is not null and (v_existing.id<>v_snapshot or v_existing.capture_metadata is distinct from v_metadata) then
    raise exception using errcode='23505',message='duoli_snapshot_conflict';
  end if;
  if exists(select 1 from private.duoli_midnight_snapshots s where s.id=v_snapshot
    and (s.platform<>v_platform or s.snapshot_day<>v_day)) then
    raise exception using errcode='23505',message='duoli_snapshot_conflict';
  end if;

  if v_action='batch' then
    if pg_catalog.jsonb_typeof(p_body->'batch_id')<>'string'
      or p_body->>'batch_id' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      or pg_catalog.jsonb_typeof(p_body->'rows')<>'array'
      or pg_catalog.jsonb_array_length(p_body->'rows') not between 1 and 200 then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    v_batch:=(p_body->>'batch_id')::uuid;
    if v_batch=v_snapshot then raise exception using errcode='22023',message='duoli_invalid_request'; end if;
    select * into v_receipt from private.duoli_midnight_batches b where b.id=v_batch;
    if found then
      if v_receipt.snapshot_id<>v_snapshot or v_receipt.body_hash<>v_body_hash then
        raise exception using errcode='23505',message='duoli_snapshot_conflict';
      end if;
      return v_ack||pg_catalog.jsonb_build_object('batch_id',p_body->>'batch_id',
        'received',v_receipt.received,'written',v_receipt.written,'replayed',true);
    end if;
    if v_existing.status in ('complete','missed') then
      raise exception using errcode='23505',message='duoli_snapshot_conflict';
    end if;
    if v_existing.id is null then
      insert into private.duoli_midnight_snapshots(id,platform,snapshot_day,scheduled_at,
        capture_started_at,capture_finished_at,capture_metadata,status)
        values(v_snapshot,v_platform,v_day,v_scheduled,v_started,v_finished,v_metadata,'partial');
    end if;
    for v_row in select r.value from pg_catalog.jsonb_array_elements(p_body->'rows') r(value) loop
      if not private.duoli_detail_keys(v_row,v_row_keys)
        or v_row->>'platform' is distinct from v_platform
        or v_row->>'business_type' is distinct from 'withdraw'
        or v_row->>'status_code' is distinct from '1'
        or v_row->>'amount_unit' is distinct from 'source_unverified'
        or pg_catalog.jsonb_typeof(v_row->'order_id')<>'string'
        or pg_catalog.length(v_row->>'order_id') not between 1 and 512
        or pg_catalog.length(pg_catalog.btrim(v_row->>'order_id'))=0
        or pg_catalog.jsonb_typeof(v_row->'source_order_id')<>'string'
        or pg_catalog.length(v_row->>'source_order_id') not between 1 and 512
        or pg_catalog.length(pg_catalog.btrim(v_row->>'source_order_id'))=0 then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row) e
        where e.key<>all(array['amount_fields_raw','raw','audit_duration_seconds']) loop
        if pg_catalog.jsonb_typeof(v_pair.value) not in ('string','null')
          or (pg_catalog.jsonb_typeof(v_pair.value)='string' and
            (pg_catalog.length(v_pair.value #>> '{}')>512 or (v_pair.value #>> '{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
      end loop;
      v_created:=private.duoli_detail_timestamp(v_row->>'created_at');
      v_updated:=case when v_row->'updated_at'='null'::jsonb then null
        else private.duoli_detail_timestamp(v_row->>'updated_at') end;
      v_audit:=case when v_row->'audit_completed_at'='null'::jsonb then null
        else private.duoli_detail_timestamp(v_row->>'audit_completed_at') end;
      if v_row->>'created_day' is distinct from (v_created at time zone 'Asia/Bangkok')::date::text
        or v_created>v_finished+interval '120 seconds'
        or (v_updated is not null and (v_updated<v_created or v_updated>v_finished+interval '120 seconds'))
        or (v_audit is not null and v_audit<v_created)
        or (v_row->>'currency' is not null and v_row->>'currency' !~ '^[A-Z0-9]{2,16}$')
        or (v_row->>'amount_raw' is not null and
          (pg_catalog.length(v_row->>'amount_raw')>128 or v_row->>'amount_raw' !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'))
        or (v_row->>'amount_source' is not null and not (v_row->>'amount_source'=any(v_amount_keys)))
        or ((v_row->>'amount_raw' is null)<>(v_row->>'amount_source' is null)) then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      if v_row->'audit_duration_seconds'<>'null'::jsonb and
        (pg_catalog.jsonb_typeof(v_row->'audit_duration_seconds')<>'number'
          or v_row->>'audit_duration_seconds' !~ '^(0|[1-9][0-9]{0,15})$') then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      if v_row->'audit_duration_seconds'<>'null'::jsonb
        and (v_row->>'audit_duration_seconds')::numeric>9007199254740991 then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      if not private.duoli_detail_keys(v_row->'amount_fields_raw',v_amount_keys,false)
        or not private.duoli_detail_keys(v_row->'raw',v_raw_keys,false) then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row->'amount_fields_raw') e loop
        if pg_catalog.jsonb_typeof(v_pair.value)<>'string' or pg_catalog.length(v_pair.value #>> '{}')>128
          or (v_pair.value #>> '{}') !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
      end loop;
      if v_row->>'amount_source' is not null and
        (v_row->'amount_fields_raw'->>(v_row->>'amount_source')) is distinct from v_row->>'amount_raw' then
        raise exception using errcode='22023',message='duoli_invalid_request';
      end if;
      for v_pair in select e.key,e.value from pg_catalog.jsonb_each(v_row->'raw') e loop
        if pg_catalog.jsonb_typeof(v_pair.value) not in ('string','number','boolean')
          or (pg_catalog.jsonb_typeof(v_pair.value)='string' and
            (pg_catalog.length(v_pair.value #>> '{}')>512 or (v_pair.value #>> '{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
          raise exception using errcode='22023',message='duoli_invalid_request';
        end if;
      end loop;
      v_source_id:=v_row->>'source_order_id';
      v_source_hash:=pg_catalog.encode(extensions.digest(v_source_id,'sha256'),'hex');
      if v_source_hash=any(v_hashes) or exists(select 1 from private.duoli_midnight_rows r
        where r.snapshot_id=v_snapshot and r.source_order_hash=v_source_hash) then
        raise exception using errcode='23505',message='duoli_snapshot_conflict';
      end if;
      v_hashes:=pg_catalog.array_append(v_hashes,v_source_hash);
      insert into private.duoli_midnight_rows(snapshot_id,source_order_id,source_order_hash,created_at,updated_at,projection)
        values(v_snapshot,v_source_id,v_source_hash,v_created,v_updated,v_row);
      v_received:=v_received+1;
    end loop;
    insert into private.duoli_midnight_batches(id,snapshot_id,body_hash,source_order_hashes,received,written)
      values(v_batch,v_snapshot,v_body_hash,v_hashes,v_received,v_received);
    update private.duoli_midnight_snapshots s set uploaded_count=s.uploaded_count+v_received where s.id=v_snapshot;
    return v_ack||pg_catalog.jsonb_build_object('batch_id',p_body->>'batch_id',
      'received',v_received,'written',v_received,'replayed',false);
  end if;

  if v_existing.status='complete' then
    if v_existing.finalized_body_hash<>v_body_hash then
      raise exception using errcode='23505',message='duoli_snapshot_conflict';
    end if;
    return v_ack||pg_catalog.jsonb_build_object('finalized',true,'source_count',v_existing.source_count,
      'uploaded_count',v_existing.uploaded_count,'replayed',true);
  elsif v_existing.status='missed' then
    raise exception using errcode='23505',message='duoli_snapshot_conflict';
  end if;
  if pg_catalog.jsonb_typeof(p_body->'source_count')<>'number'
    or p_body->>'source_count' !~ '^(0|[1-9][0-9]{0,8})$'
    or pg_catalog.jsonb_typeof(p_body->'batch_ids')<>'array' then
    raise exception using errcode='22023',message='duoli_invalid_request';
  end if;
  v_source_count:=(p_body->>'source_count')::integer;
  for v_row in select r.value from pg_catalog.jsonb_array_elements(p_body->'batch_ids') r(value) loop
    if pg_catalog.jsonb_typeof(v_row)<>'string'
      or v_row #>> '{}' !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      or (v_row #>> '{}')::uuid=any(v_batch_ids) then
      raise exception using errcode='22023',message='duoli_invalid_request';
    end if;
    v_batch_ids:=pg_catalog.array_append(v_batch_ids,(v_row #>> '{}')::uuid);
  end loop;
  select pg_catalog.count(*)::integer,coalesce(pg_catalog.sum(b.received),0)::integer
    into v_receipt_count,v_receipt_rows from private.duoli_midnight_batches b where b.snapshot_id=v_snapshot;
  select pg_catalog.count(*)::integer into v_matching_count from private.duoli_midnight_batches b
    where b.snapshot_id=v_snapshot and b.id=any(v_batch_ids);
  select pg_catalog.count(distinct h.hash)::integer into v_distinct_rows
    from private.duoli_midnight_batches b cross join lateral pg_catalog.unnest(b.source_order_hashes) h(hash)
    where b.snapshot_id=v_snapshot;
  select pg_catalog.count(*)::integer into v_received from private.duoli_midnight_rows r
    where r.snapshot_id=v_snapshot and exists(select 1 from private.duoli_midnight_batches b
      where b.snapshot_id=v_snapshot and r.source_order_hash=any(b.source_order_hashes));
  if v_receipt_count<>pg_catalog.cardinality(v_batch_ids) or v_matching_count<>v_receipt_count
    or v_receipt_rows<>v_source_count or v_distinct_rows<>v_source_count or v_received<>v_source_count
    or (select pg_catalog.count(*) from private.duoli_midnight_rows r where r.snapshot_id=v_snapshot)<>v_source_count then
    raise exception using errcode='23514',message='duoli_incomplete_snapshot';
  end if;
  if v_existing.id is null then
    insert into private.duoli_midnight_snapshots(id,platform,snapshot_day,scheduled_at,
      capture_started_at,capture_finished_at,capture_metadata,status,source_count,uploaded_count,finalized_body_hash)
      values(v_snapshot,v_platform,v_day,v_scheduled,v_started,v_finished,v_metadata,'complete',0,0,v_body_hash);
  else
    update private.duoli_midnight_snapshots s set status='complete',source_count=v_source_count,
      uploaded_count=v_source_count,finalized_body_hash=v_body_hash where s.id=v_snapshot;
  end if;
  return v_ack||pg_catalog.jsonb_build_object('finalized',true,'source_count',v_source_count,
    'uploaded_count',v_source_count,'replayed',false);
end $function$;
REVOKE ALL ON FUNCTION public.duoli_midnight_ingest(p_key text, p_body jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.duoli_midnight_ingest(p_key text, p_body jsonb) TO "service_role";
