-- Readonly production column/constraint metadata; no table rows.
create table public.newar_detail_platforms (
  platform text not null,
  country_code text not null,
  country text not null,
  timezone text not null,
  currency text not null,
  enabled boolean not null default true,
  launch_at timestamp with time zone,
  CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
  PRIMARY KEY (platform)
);

create table public.collection_success_snapshot_receipts (
  snapshot_id uuid not null,
  payload_hash text not null,
  received_at timestamp with time zone not null default now(),
  CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text)),
  PRIMARY KEY (snapshot_id)
);

create table public.workorder_issue_snapshot_receipts (
  snapshot_id uuid not null,
  payload_hash text not null,
  received_at timestamp with time zone not null default clock_timestamp(),
  CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text)),
  PRIMARY KEY (snapshot_id)
);

create table private.newar_business_batches (
  batch_id uuid not null,
  payload_hash text not null,
  platform text not null,
  kind text not null,
  receipt jsonb not null,
  received_at timestamp with time zone not null default now(),
  PRIMARY KEY (batch_id)
);

create table private.newar_business_credentials (
  token_hash text not null,
  allowed_scopes jsonb not null,
  expires_at timestamp with time zone not null,
  revoked boolean not null default false,
  created_at timestamp with time zone not null default now(),
  CHECK ((jsonb_typeof(allowed_scopes) = 'array'::text)),
  PRIMARY KEY (token_hash),
  CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

create table private.newar_detail_batches (
  batch_id uuid not null,
  payload_hash text not null,
  platform text not null,
  dataset text not null,
  received_count integer not null,
  written_count integer not null,
  stale_count integer not null,
  received_at timestamp with time zone not null default now(),
  CHECK ((received_count = (written_count + stale_count))),
  PRIMARY KEY (batch_id),
  FOREIGN KEY (platform) REFERENCES newar_detail_platforms(platform)
);

create table private.newar_detail_credentials (
  token_hash text not null,
  allowed_scopes jsonb not null,
  expires_at timestamp with time zone not null,
  revoked boolean not null default false,
  created_at timestamp with time zone not null default now(),
  CHECK ((jsonb_typeof(allowed_scopes) = 'array'::text)),
  PRIMARY KEY (token_hash),
  CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

create table public.ar_business_direct_credentials (
  token_hash text not null,
  allowed_scopes jsonb not null,
  expires_at timestamp with time zone not null,
  revoked boolean not null default false,
  created_at timestamp with time zone not null default now(),
  CHECK ((jsonb_typeof(allowed_scopes) = 'array'::text)),
  PRIMARY KEY (token_hash),
  CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

create table public.ar_collected_order_receipts (
  batch_id uuid not null,
  payload_hash text not null,
  order_count integer not null,
  received_at timestamp with time zone not null default clock_timestamp(),
  CHECK (((order_count >= 0) AND (order_count <= 500))),
  CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text)),
  PRIMARY KEY (batch_id)
);

create table public.ar_collected_orders (
  source_system text not null,
  country_code text not null,
  platform text not null,
  order_kind text not null,
  order_no text not null,
  member_id text,
  amount numeric(20,2),
  amount_text text,
  status text,
  applied_at timestamp without time zone,
  completed_at timestamp without time zone,
  operator text,
  raw_channel text,
  channel_type text,
  remark text,
  manual_remark text,
  observed_at timestamp with time zone not null,
  batch_id uuid not null,
  updated_at timestamp with time zone not null default clock_timestamp(),
  CHECK (((amount >= (0)::numeric) AND (amount <= 90071992547409.91))),
  CHECK ((length(amount_text) <= 100)),
  FOREIGN KEY (batch_id) REFERENCES ar_collected_order_receipts(batch_id),
  CHECK ((length(channel_type) <= 240)),
  CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
  CHECK ((length(manual_remark) <= 8000)),
  CHECK (((length(member_id) >= 1) AND (length(member_id) <= 80))),
  CHECK ((length(operator) <= 240)),
  CHECK ((order_kind = ANY (ARRAY['recharge'::text, 'withdraw'::text]))),
  CHECK (((length(order_no) >= 1) AND (length(order_no) <= 160))),
  PRIMARY KEY (source_system, country_code, platform, order_kind, order_no),
  CHECK ((length(raw_channel) <= 240)),
  CHECK ((length(remark) <= 8000)),
  CHECK ((source_system = 'AR'::text)),
  CHECK ((length(status) <= 160))
);

create table public.ar_config_targets (
  country_code text not null,
  platform text not null,
  country_name text not null,
  timezone text not null,
  currency text,
  source_system text not null default 'AR'::text,
  PRIMARY KEY (country_code, platform),
  CHECK ((source_system = ANY (ARRAY['AR'::text, 'NEW_AR'::text])))
);

create table public.collection_success_credentials (
  token_hash text not null,
  source_system text not null,
  allowed_scopes jsonb not null,
  expires_at timestamp with time zone not null,
  revoked boolean not null default false,
  label text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  allowed_source_systems text[] not null,
  CHECK (
CASE
    WHEN (jsonb_typeof(allowed_scopes) = 'array'::text) THEN ((jsonb_array_length(allowed_scopes) >= 1) AND (jsonb_array_length(allowed_scopes) <= 1000))
    ELSE false
END),
  CHECK ((((cardinality(allowed_source_systems) >= 1) AND (cardinality(allowed_source_systems) <= 4)) AND (allowed_source_systems <@ ARRAY['RECHARGE_REVIEW'::text, 'WITHDRAW_REVIEW'::text]))),
  CHECK ((length(label) <= 120)),
  PRIMARY KEY (token_hash),
  CHECK ((source_system = 'RECHARGE_REVIEW'::text)),
  CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

create table public.collection_success_daily (
  source_system text not null,
  country_code text not null,
  platform text not null,
  stat_date date not null,
  snapshot_id uuid not null,
  snapshot_at timestamp with time zone not null,
  snapshot jsonb not null,
  updated_at timestamp with time zone not null default now(),
  CHECK (((snapshot ->> 'source_system'::text) = source_system)),
  CHECK (((snapshot ->> 'country_code'::text) = country_code)),
  CHECK (((snapshot ->> 'platform'::text) = platform)),
  CHECK ((((snapshot ->> 'stat_date'::text))::date = stat_date)),
  CHECK ((((snapshot ->> 'snapshot_id'::text))::uuid = snapshot_id)),
  CHECK ((((snapshot ->> 'snapshot_at'::text))::timestamp with time zone = snapshot_at)),
  CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
  PRIMARY KEY (source_system, country_code, platform, stat_date),
  CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
  CHECK (((snapshot #> '{coverage,complete}'::text[]) = 'true'::jsonb)),
  FOREIGN KEY (snapshot_id) REFERENCES collection_success_snapshot_receipts(snapshot_id),
  UNIQUE (snapshot_id),
  CHECK ((source_system = ANY (ARRAY['RECHARGE_REVIEW'::text, 'WITHDRAW_REVIEW'::text])))
);

create table public.dashboard_platform_team_map (
  id uuid not null default gen_random_uuid(),
  team_name text not null,
  system_name text not null,
  source_system text not null,
  country_name text not null,
  country_code text not null,
  source_country text not null,
  platform_name text not null,
  source_platform text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  PRIMARY KEY (id),
  UNIQUE (source_system, source_country, source_platform)
);

create table public.newar_business_snapshots (
  kind text not null,
  platform text not null,
  country_code text not null,
  country text not null,
  stat_date date not null,
  direction text not null,
  captured_at timestamp with time zone not null,
  payload jsonb not null,
  component_captured_at jsonb not null,
  updated_at timestamp with time zone not null default now(),
  CHECK ((direction = ANY (ARRAY['charge'::text, 'withdraw'::text, 'all'::text]))),
  CHECK ((kind = ANY (ARRAY['third_party_volume'::text, 'auto_withdraw_bundle'::text, 'workorder_daily_bundle'::text]))),
  PRIMARY KEY (kind, platform, stat_date, direction),
  CHECK ((platform = ANY (ARRAY['POPZAR'::text, 'DhaniWin'::text, '92BLAZE'::text])))
);

create table public.newar_detail_records (
  id uuid not null default gen_random_uuid(),
  platform text not null,
  dataset text not null,
  source_id text not null,
  member_id text,
  order_number text,
  third_party_order_number text,
  provider text,
  provider_id text,
  channel_type text,
  currency text,
  amount numeric(24,8) not null,
  actual_amount numeric(24,8),
  fee numeric(24,8),
  status_code text,
  status_group text not null,
  created_at timestamp with time zone not null,
  success_at timestamp with time zone,
  processed_at timestamp with time zone,
  source_updated_at timestamp with time zone,
  captured_at timestamp with time zone not null,
  workorder_type text,
  operator text,
  followup_count integer,
  raw jsonb not null default '{}'::jsonb,
  received_at timestamp with time zone not null default now(),
  CHECK (((actual_amount >= (0)::numeric) AND ((actual_amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])))),
  CHECK (((amount >= (0)::numeric) AND ((amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])))),
  CHECK (((success_at IS NULL) OR ((status_group = 'success'::text) AND (success_at >= created_at)))),
  CHECK (((processed_at IS NULL) OR (processed_at >= created_at))),
  CHECK (((currency IS NULL) OR (currency ~ '^[A-Z0-9]{3,8}$'::text))),
  CHECK ((dataset = ANY (ARRAY['charge'::text, 'withdraw'::text, 'workorder'::text]))),
  CHECK (((fee >= (0)::numeric) AND ((fee)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text])))),
  CHECK ((followup_count >= 0)),
  PRIMARY KEY (id),
  UNIQUE (platform, dataset, source_id),
  FOREIGN KEY (platform) REFERENCES newar_detail_platforms(platform),
  CHECK ((jsonb_typeof(raw) = 'object'::text)),
  CHECK (((length(source_id) >= 1) AND (length(source_id) <= 200))),
  CHECK ((status_group = ANY (ARRAY['success'::text, 'pending'::text, 'failed'::text, 'rejected'::text, 'unknown'::text])))
);

create table public.workorder_deposit_daily (
  system_name text not null,
  source_system text not null,
  stat_date date not null,
  country_code text not null,
  country text not null,
  platform text not null,
  third_party text not null,
  channel_type text not null,
  submitted_count bigint not null,
  submitted_amount numeric(24,2) not null,
  success_count bigint not null,
  success_amount numeric(24,2) not null,
  status_counts jsonb not null default '{}'::jsonb,
  source_updated_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  withdraw_not_received_count bigint not null default 0,
  withdraw_not_received_amount numeric(24,2) not null default 0,
  withdraw_success_count bigint not null default 0,
  withdraw_success_amount numeric(24,2) not null default 0,
  CHECK (((success_count >= 0) AND (success_count <= submitted_count))),
  CHECK (((success_amount >= (0)::numeric) AND (success_amount <= submitted_amount))),
  CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
  PRIMARY KEY (system_name, stat_date, country_code, platform, third_party, channel_type),
  CHECK ((source_system = 'AR_WORKORDER'::text)),
  CHECK ((jsonb_typeof(status_counts) = 'object'::text)),
  CHECK ((submitted_amount >= (0)::numeric)),
  CHECK ((submitted_count >= 0)),
  CHECK ((system_name = 'AR'::text)),
  CHECK ((withdraw_not_received_amount >= (0)::numeric)),
  CHECK ((withdraw_not_received_count >= 0)),
  CHECK (((withdraw_success_amount >= (0)::numeric) AND (withdraw_success_amount <= withdraw_not_received_amount))),
  CHECK (((withdraw_success_count >= 0) AND (withdraw_success_count <= withdraw_not_received_count)))
);

create table public.workorder_issue_credentials (
  token_hash text not null,
  source_system text not null,
  allowed_source_systems text[] not null default ARRAY['AR_WORKORDER'::text],
  allowed_scopes jsonb not null,
  expires_at timestamp with time zone not null,
  revoked boolean not null default false,
  label text not null default ''::text,
  created_at timestamp with time zone not null default clock_timestamp(),
  CHECK (workorder_issue_scopes_are_allowed(allowed_scopes)),
  CHECK (((cardinality(allowed_source_systems) = 1) AND (allowed_source_systems = ARRAY['AR_WORKORDER'::text]))),
  CHECK (((length(label) <= 120) AND (label !~ '[[:cntrl:]]'::text))),
  PRIMARY KEY (token_hash),
  CHECK ((source_system = 'AR_WORKORDER'::text)),
  CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

create table public.workorder_issue_snapshot_heads (
  source_system text not null,
  country_code text not null,
  platform text not null,
  timezone text not null,
  stat_date date not null,
  current_snapshot_id uuid not null,
  snapshot_at timestamp with time zone not null,
  updated_at timestamp with time zone not null default clock_timestamp(),
  CHECK ((((country_code = 'PK'::text) AND (platform = ANY (ARRAY['POPZAR'::text, '92BLAZE'::text])) AND (timezone = 'Asia/Karachi'::text)) OR ((country_code = 'IN'::text) AND (platform = 'DhaniWin'::text) AND (timezone = 'Asia/Kolkata'::text)))),
  FOREIGN KEY (current_snapshot_id) REFERENCES workorder_issue_snapshot_receipts(snapshot_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (current_snapshot_id),
  PRIMARY KEY (source_system, country_code, platform, stat_date),
  CHECK ((source_system = 'AR_WORKORDER'::text))
);
