-- Recovery comparison: Google issue/follow-up mirrors plus explicit Portal evidence.
-- No source rows, accounts, classification rules outside this section, or schema are modified.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
-- Reproduce catalog deparsing from the reviewed metadata; every access below is schema-qualified.
set local search_path=public,pg_catalog;
lock table public.admin_deposit_issue_rows,public.admin_deposit_followup_rows,public.ar_workorder_issue_details,public.newar_detail_records,public.newar_detail_platforms in access share mode nowait;
do $install$
declare spec jsonb;actual_hash text;actual_meta jsonb;object_count integer;definition text;baseline_state boolean;patched_state boolean;
begin
 if current_user<>'postgres'then raise exception 'recovery_owner_required';end if;

 for spec in select value from jsonb_array_elements($deps$[{"signature": "private.dashboard_scope_allows(jsonb,text,text)", "md5": "87042edcedc3200c559a821250de831e", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}", "args": "p_scope jsonb, p_country text, p_platform text DEFAULT ''::text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "boolean", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 1}}, {"signature": "private.dashboard_admin_live_scope()", "md5": "bab25103334aa222d6220a27881ce000", "metadata": {"acl": "{postgres=X/postgres}", "args": "", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_live_deposit_platform_key(text,text)", "md5": "e2d393715ea9c1354e5a5cfc5340e39b", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_country text, p_name text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "text", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.workorder_receipt_date(text)", "md5": "7d9dfcd7036f11bf5dd257f4ea36e808", "metadata": {"acl": "{postgres=X/postgres,service_role=X/postgres}", "args": "p_order text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "date", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_deposit_statistics(jsonb)", "md5": "57795c6ea7e81f2bab17b82ff82cff18", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres}", "args": "p_request jsonb DEFAULT '{}'::jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\"", "statement_timeout=20s"], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 1}}, {"signature": "private.dashboard_role_access()", "md5": "423aab3bb0ec685aa745a18ea6b7811a", "metadata": {"acl": "{postgres=X/postgres}", "args": "", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "public.dashboard_admin_execute(text,jsonb)", "md5": "212a33785c64b3266f4eb84de8b0492b", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres}", "args": "p_page text, p_request jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "v", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_live_platforms()", "md5": "9423bd69a95d21c9e6740c6709492395", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres}", "args": "", "cost": 100, "kind": "f", "rows": 1000, "owner": "postgres", "config": ["search_path=\"\""], "result": "TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_live_withdraw_key(text)", "md5": "440671f01a670ad05695e9b8692888a3", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_name text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "text", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 0}}]$deps$::jsonb)loop
  select md5(f.prosrc),jsonb_build_object('owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid),'language',l.lanname,'volatile',f.provolatile,'secdef',f.prosecdef,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'nargdefaults',f.pronargdefaults,'variadic',f.provariadic::text,'kind',f.prokind) into actual_hash,actual_meta from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(spec->>'signature');
  if actual_hash is null or actual_meta is distinct from spec->'metadata' then raise exception 'recovery_dependency_metadata_drift: %',spec->>'signature';end if;
  if spec->>'signature' in ('private.dashboard_admin_deposit_statistics(jsonb)','public.dashboard_admin_execute(text,jsonb)')then
   if actual_hash not in (case when spec->>'signature'='private.dashboard_admin_deposit_statistics(jsonb)'then '57795c6ea7e81f2bab17b82ff82cff18'else '212a33785c64b3266f4eb84de8b0492b'end,case when spec->>'signature'='private.dashboard_admin_deposit_statistics(jsonb)'then '30030c8a18b0e2153cbb661f63aaebe2'else 'f4070e4c3b21d717ddd445d7384964f0'end)then raise exception 'recovery_dependency_body_drift: %',spec->>'signature';end if;
  elsif actual_hash<>spec->>'md5' then raise exception 'recovery_dependency_body_drift: %',spec->>'signature';end if;
 end loop;

 for spec in select value from jsonb_array_elements($tables$[{"acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "rls": true, "kind": "r", "name": "newar_detail_platforms", "owner": "postgres", "columns": [{"name": "platform", "type": "text", "notnull": true}, {"name": "country_code", "type": "text", "notnull": true}, {"name": "country", "type": "text", "notnull": true}, {"name": "timezone", "type": "text", "notnull": true}, {"name": "currency", "type": "text", "notnull": true}, {"name": "enabled", "type": "boolean", "notnull": true}, {"name": "launch_at", "type": "timestamp with time zone", "notnull": false}], "indexes": [{"live": true, "name": "newar_detail_platforms_pkey", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX newar_detail_platforms_pkey ON public.newar_detail_platforms USING btree (platform)"}], "forceRls": false, "constraints": [{"name": "newar_detail_platforms_country_code_check", "validated": true, "definition": "CHECK ((country_code ~ '^[A-Z]{2}$'::text))"}, {"name": "newar_detail_platforms_pkey", "validated": true, "definition": "PRIMARY KEY (platform)"}], "inheritCount": 0}, {"acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "rls": true, "kind": "r", "name": "newar_detail_records", "owner": "postgres", "columns": [{"name": "id", "type": "uuid", "notnull": true}, {"name": "platform", "type": "text", "notnull": true}, {"name": "dataset", "type": "text", "notnull": true}, {"name": "source_id", "type": "text", "notnull": true}, {"name": "member_id", "type": "text", "notnull": false}, {"name": "order_number", "type": "text", "notnull": false}, {"name": "third_party_order_number", "type": "text", "notnull": false}, {"name": "provider", "type": "text", "notnull": false}, {"name": "provider_id", "type": "text", "notnull": false}, {"name": "channel_type", "type": "text", "notnull": false}, {"name": "currency", "type": "text", "notnull": false}, {"name": "amount", "type": "numeric(24,8)", "notnull": true}, {"name": "actual_amount", "type": "numeric(24,8)", "notnull": false}, {"name": "fee", "type": "numeric(24,8)", "notnull": false}, {"name": "status_code", "type": "text", "notnull": false}, {"name": "status_group", "type": "text", "notnull": true}, {"name": "created_at", "type": "timestamp with time zone", "notnull": true}, {"name": "success_at", "type": "timestamp with time zone", "notnull": false}, {"name": "processed_at", "type": "timestamp with time zone", "notnull": false}, {"name": "source_updated_at", "type": "timestamp with time zone", "notnull": false}, {"name": "captured_at", "type": "timestamp with time zone", "notnull": true}, {"name": "workorder_type", "type": "text", "notnull": false}, {"name": "operator", "type": "text", "notnull": false}, {"name": "followup_count", "type": "integer", "notnull": false}, {"name": "raw", "type": "jsonb", "notnull": true}, {"name": "received_at", "type": "timestamp with time zone", "notnull": true}], "indexes": [{"live": true, "name": "newar_detail_business_cover_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_business_cover_idx ON public.newar_detail_records USING btree (platform, dataset, created_at) INCLUDE (status_group, amount, currency, provider, channel_type, captured_at, received_at)"}, {"live": true, "name": "newar_detail_created_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_created_idx ON public.newar_detail_records USING btree (platform, dataset, created_at DESC, id DESC)"}, {"live": true, "name": "newar_detail_member_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_member_idx ON public.newar_detail_records USING btree (platform, dataset, member_id, created_at DESC, id DESC) WHERE (member_id IS NOT NULL)"}, {"live": true, "name": "newar_detail_order_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_order_idx ON public.newar_detail_records USING btree (platform, dataset, order_number) WHERE (order_number IS NOT NULL)"}, {"live": true, "name": "newar_detail_processed_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_processed_idx ON public.newar_detail_records USING btree (platform, dataset, processed_at DESC, id DESC) WHERE (processed_at IS NOT NULL)"}, {"live": true, "name": "newar_detail_records_pkey", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX newar_detail_records_pkey ON public.newar_detail_records USING btree (id)"}, {"live": true, "name": "newar_detail_records_platform_dataset_source_id_key", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX newar_detail_records_platform_dataset_source_id_key ON public.newar_detail_records USING btree (platform, dataset, source_id)"}, {"live": true, "name": "newar_detail_success_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_success_idx ON public.newar_detail_records USING btree (platform, dataset, success_at DESC, id DESC) WHERE ((status_group = 'success'::text) AND (success_at IS NOT NULL))"}, {"live": true, "name": "newar_detail_third_order_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_detail_third_order_idx ON public.newar_detail_records USING btree (platform, dataset, third_party_order_number) WHERE (third_party_order_number IS NOT NULL)"}, {"live": true, "name": "newar_member_two_created_cover_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_member_two_created_cover_idx ON public.newar_detail_records USING btree (platform, dataset, created_at) INCLUDE (member_id, currency) WHERE ((platform = ANY (ARRAY['MAANWIN'::text, 'DhaniWin'::text])) AND (dataset = ANY (ARRAY['charge'::text, 'withdraw'::text])))"}, {"live": true, "name": "newar_member_two_success_cover_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_member_two_success_cover_idx ON public.newar_detail_records USING btree (platform, dataset, success_at) INCLUDE (member_id, currency, created_at) WHERE ((platform = ANY (ARRAY['MAANWIN'::text, 'DhaniWin'::text])) AND (dataset = ANY (ARRAY['charge'::text, 'withdraw'::text])) AND (status_group = 'success'::text) AND (success_at IS NOT NULL))"}, {"live": true, "name": "newar_workorder_deposit_identity_hash_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_workorder_deposit_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'depositOrderNo'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'depositOrderNo'::text)) = 'string'::text))"}, {"live": true, "name": "newar_workorder_recharge_identity_hash_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX newar_workorder_recharge_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'rechargeNumber'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'rechargeNumber'::text)) = 'string'::text))"}], "forceRls": false, "constraints": [{"name": "newar_detail_records_actual_amount_check", "validated": true, "definition": "CHECK (((actual_amount >= (0)::numeric) AND ((actual_amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))))"}, {"name": "newar_detail_records_amount_check", "validated": true, "definition": "CHECK (((amount >= (0)::numeric) AND ((amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))))"}, {"name": "newar_detail_records_check", "validated": true, "definition": "CHECK (((success_at IS NULL) OR ((status_group = 'success'::text) AND (success_at >= created_at))))"}, {"name": "newar_detail_records_check1", "validated": true, "definition": "CHECK (((processed_at IS NULL) OR (processed_at >= created_at)))"}, {"name": "newar_detail_records_currency_check", "validated": true, "definition": "CHECK (((currency IS NULL) OR (currency ~ '^[A-Z0-9]{3,8}$'::text)))"}, {"name": "newar_detail_records_dataset_check", "validated": true, "definition": "CHECK ((dataset = ANY (ARRAY['charge'::text, 'withdraw'::text, 'workorder'::text])))"}, {"name": "newar_detail_records_fee_check", "validated": true, "definition": "CHECK (((fee >= (0)::numeric) AND ((fee)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))))"}, {"name": "newar_detail_records_followup_count_check", "validated": true, "definition": "CHECK ((followup_count >= 0))"}, {"name": "newar_detail_records_pkey", "validated": true, "definition": "PRIMARY KEY (id)"}, {"name": "newar_detail_records_platform_dataset_source_id_key", "validated": true, "definition": "UNIQUE (platform, dataset, source_id)"}, {"name": "newar_detail_records_platform_fkey", "validated": true, "definition": "FOREIGN KEY (platform) REFERENCES newar_detail_platforms(platform)"}, {"name": "newar_detail_records_raw_check", "validated": true, "definition": "CHECK ((jsonb_typeof(raw) = 'object'::text))"}, {"name": "newar_detail_records_source_id_check", "validated": true, "definition": "CHECK (((length(source_id) >= 1) AND (length(source_id) <= 200)))"}, {"name": "newar_detail_records_status_group_check", "validated": true, "definition": "CHECK ((status_group = ANY (ARRAY['success'::text, 'pending'::text, 'failed'::text, 'rejected'::text, 'unknown'::text])))"}], "inheritCount": 0}, {"acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "rls": true, "kind": "r", "name": "admin_deposit_issue_rows", "owner": "postgres", "columns": [{"name": "id", "type": "text", "notnull": true}, {"name": "source_sheet", "type": "text", "notnull": true}, {"name": "source_tab", "type": "text", "notnull": true}, {"name": "source_row", "type": "integer", "notnull": true}, {"name": "platform", "type": "text", "notnull": false}, {"name": "country", "type": "text", "notnull": false}, {"name": "order_number", "type": "text", "notnull": false}, {"name": "utr", "type": "text", "notnull": false}, {"name": "amount", "type": "numeric(24,2)", "notnull": false}, {"name": "provider", "type": "text", "notnull": false}, {"name": "match_status", "type": "text", "notnull": false}, {"name": "status", "type": "text", "notnull": false}, {"name": "unreceived_days", "type": "integer", "notnull": false}, {"name": "record_date", "type": "date", "notnull": false}, {"name": "source_updated_at", "type": "timestamp with time zone", "notnull": false}, {"name": "updated_at", "type": "timestamp with time zone", "notnull": true}, {"name": "provider_reply", "type": "text", "notnull": false}, {"name": "utr_match", "type": "text", "notnull": false}, {"name": "kyc_correct", "type": "text", "notnull": false}, {"name": "upi_id", "type": "text", "notnull": false}, {"name": "kyc_upi_id", "type": "text", "notnull": false}, {"name": "stale_at", "type": "timestamp with time zone", "notnull": false}, {"name": "canonical_provider", "type": "text", "notnull": false}, {"name": "confirmation_status", "type": "text", "notnull": false}], "indexes": [{"live": true, "name": "admin_deposit_issue_rows_date_idx", "ready": true, "valid": true, "definition": "CREATE INDEX admin_deposit_issue_rows_date_idx ON public.admin_deposit_issue_rows USING btree (record_date DESC, platform, provider, status)"}, {"live": true, "name": "admin_deposit_issue_rows_order_idx", "ready": true, "valid": true, "definition": "CREATE INDEX admin_deposit_issue_rows_order_idx ON public.admin_deposit_issue_rows USING btree (order_number, utr)"}, {"live": true, "name": "admin_deposit_issue_rows_pkey", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX admin_deposit_issue_rows_pkey ON public.admin_deposit_issue_rows USING btree (id)"}, {"live": true, "name": "admin_deposit_issue_rows_scope_idx", "ready": true, "valid": true, "definition": "CREATE INDEX admin_deposit_issue_rows_scope_idx ON public.admin_deposit_issue_rows USING btree (country, platform, record_date DESC)"}, {"live": true, "name": "admin_deposit_issue_rows_source_sheet_source_tab_source_row_key", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX admin_deposit_issue_rows_source_sheet_source_tab_source_row_key ON public.admin_deposit_issue_rows USING btree (source_sheet, source_tab, source_row)"}], "forceRls": false, "constraints": [{"name": "admin_deposit_issue_rows_pkey", "validated": true, "definition": "PRIMARY KEY (id)"}, {"name": "admin_deposit_issue_rows_source_row_check", "validated": true, "definition": "CHECK ((source_row > 0))"}, {"name": "admin_deposit_issue_rows_source_sheet_source_tab_source_row_key", "validated": true, "definition": "UNIQUE (source_sheet, source_tab, source_row)"}], "inheritCount": 0}, {"acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "rls": true, "kind": "r", "name": "admin_deposit_followup_rows", "owner": "postgres", "columns": [{"name": "id", "type": "text", "notnull": true}, {"name": "source_sheet", "type": "text", "notnull": true}, {"name": "source_tab", "type": "text", "notnull": true}, {"name": "source_gid", "type": "bigint", "notnull": false}, {"name": "source_row", "type": "integer", "notnull": true}, {"name": "platform", "type": "text", "notnull": false}, {"name": "country", "type": "text", "notnull": false}, {"name": "order_number", "type": "text", "notnull": false}, {"name": "work_order_number", "type": "text", "notnull": false}, {"name": "utr", "type": "text", "notnull": false}, {"name": "amount", "type": "numeric(24,2)", "notnull": false}, {"name": "provider", "type": "text", "notnull": false}, {"name": "provider_reply", "type": "text", "notnull": false}, {"name": "followup_status", "type": "text", "notnull": false}, {"name": "utr_match", "type": "text", "notnull": false}, {"name": "kyc_correct", "type": "text", "notnull": false}, {"name": "evidence", "type": "text", "notnull": false}, {"name": "followup_at", "type": "text", "notnull": false}, {"name": "followup_date", "type": "date", "notnull": false}, {"name": "receipt_text", "type": "text", "notnull": false}, {"name": "source_updated_at", "type": "timestamp with time zone", "notnull": false}, {"name": "updated_at", "type": "timestamp with time zone", "notnull": true}, {"name": "source_kind", "type": "text", "notnull": true}, {"name": "first_actor", "type": "text", "notnull": false}, {"name": "last_actor", "type": "text", "notnull": false}, {"name": "portal_case_id", "type": "text", "notnull": false}, {"name": "portal_version", "type": "bigint", "notnull": false}, {"name": "portal_owner_id", "type": "text", "notnull": false}, {"name": "staff_code", "type": "text", "notnull": false}, {"name": "source_date_text", "type": "text", "notnull": false}, {"name": "portal_payload", "type": "jsonb", "notnull": false}, {"name": "portal_team", "type": "text", "notnull": false}, {"name": "upi_id", "type": "text", "notnull": false}, {"name": "kyc_upi_id", "type": "text", "notnull": false}, {"name": "stale_at", "type": "timestamp with time zone", "notnull": false}], "indexes": [{"live": true, "name": "admin_deposit_followup_order_idx", "ready": true, "valid": true, "definition": "CREATE INDEX admin_deposit_followup_order_idx ON public.admin_deposit_followup_rows USING btree (order_number, utr)"}, {"live": true, "name": "admin_deposit_followup_rows_pkey", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX admin_deposit_followup_rows_pkey ON public.admin_deposit_followup_rows USING btree (id)"}, {"live": true, "name": "admin_deposit_followup_rows_source_sheet_source_tab_source__key", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX admin_deposit_followup_rows_source_sheet_source_tab_source__key ON public.admin_deposit_followup_rows USING btree (source_sheet, source_tab, source_row)"}, {"live": true, "name": "admin_deposit_followup_scope_idx", "ready": true, "valid": true, "definition": "CREATE INDEX admin_deposit_followup_scope_idx ON public.admin_deposit_followup_rows USING btree (country, platform, followup_date DESC)"}], "forceRls": false, "constraints": [{"name": "admin_deposit_followup_rows_pkey", "validated": true, "definition": "PRIMARY KEY (id)"}, {"name": "admin_deposit_followup_rows_source_row_check", "validated": true, "definition": "CHECK ((source_row > 0))"}, {"name": "admin_deposit_followup_rows_source_sheet_source_tab_source__key", "validated": true, "definition": "UNIQUE (source_sheet, source_tab, source_row)"}], "inheritCount": 0}, {"acl": "{postgres=arwdDxtm/postgres,service_role=arw/postgres}", "rls": true, "kind": "r", "name": "ar_workorder_issue_details", "owner": "postgres", "columns": [{"name": "system_name", "type": "text", "notnull": true}, {"name": "country_code", "type": "text", "notnull": true}, {"name": "country", "type": "text", "notnull": true}, {"name": "platform", "type": "text", "notnull": true}, {"name": "tenant_id", "type": "text", "notnull": false}, {"name": "work_order_id", "type": "text", "notnull": true}, {"name": "source_record_id", "type": "text", "notnull": false}, {"name": "work_order_no", "type": "text", "notnull": false}, {"name": "source_order_no", "type": "text", "notnull": false}, {"name": "payment_order_no", "type": "text", "notnull": false}, {"name": "utr", "type": "text", "notnull": false}, {"name": "issue_kind", "type": "text", "notnull": true}, {"name": "work_order_type_id", "type": "integer", "notnull": false}, {"name": "work_order_type_name", "type": "text", "notnull": false}, {"name": "work_order_name", "type": "text", "notnull": false}, {"name": "status_code", "type": "integer", "notnull": false}, {"name": "amount", "type": "numeric(24,8)", "notnull": false}, {"name": "third_party", "type": "text", "notnull": false}, {"name": "third_party_source_name", "type": "text", "notnull": false}, {"name": "third_party_mapping_code", "type": "text", "notnull": false}, {"name": "third_party_channel_id", "type": "text", "notnull": false}, {"name": "channel_type", "type": "text", "notnull": false}, {"name": "kyc_connected", "type": "boolean", "notnull": false}, {"name": "kyc_status_source", "type": "text", "notnull": false}, {"name": "utr_matched", "type": "boolean", "notnull": false}, {"name": "reminder_count", "type": "integer", "notnull": false}, {"name": "attachment_types", "type": "text[]", "notnull": false}, {"name": "submitted_at", "type": "timestamp with time zone", "notnull": false}, {"name": "operated_at", "type": "timestamp with time zone", "notnull": false}, {"name": "operator_account", "type": "text", "notnull": false}, {"name": "source_updated_at", "type": "timestamp with time zone", "notnull": false}, {"name": "observed_at", "type": "timestamp with time zone", "notnull": true}, {"name": "query_date", "type": "date", "notnull": true}, {"name": "schema_version", "type": "integer", "notnull": true}, {"name": "query_basis", "type": "text", "notnull": true}, {"name": "submitted_date", "type": "date", "notnull": false}, {"name": "last_updated_by", "type": "text", "notnull": false}, {"name": "attachment_type_codes", "type": "integer[]", "notnull": false}, {"name": "operation_time_source", "type": "text", "notnull": false}, {"name": "field_gaps", "type": "text[]", "notnull": true}, {"name": "source_form_id", "type": "integer", "notnull": false}, {"name": "source_type_code", "type": "integer", "notnull": false}, {"name": "kyc_link_status_code", "type": "integer", "notnull": false}, {"name": "is_locked_by_current_user", "type": "boolean", "notnull": false}, {"name": "source_vip_level", "type": "text", "notnull": false}, {"name": "source_pay_type_id", "type": "integer", "notnull": false}], "indexes": [{"live": true, "name": "ar_deposit_order_operation_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_deposit_order_operation_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, operated_at, work_order_id) WHERE ((issue_kind = 'deposit'::text) AND (operation_time_source IS NOT NULL))"}, {"live": true, "name": "ar_deposit_order_payment_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_deposit_order_payment_v1_idx ON public.ar_workorder_issue_details USING btree (system_name, country_code, platform, payment_order_no, work_order_id) WHERE ((issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL))"}, {"live": true, "name": "ar_deposit_order_submission_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_deposit_order_submission_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_date, work_order_id) WHERE (issue_kind = 'deposit'::text)"}, {"live": true, "name": "ar_evidence_retention_state4_v1", "ready": true, "valid": true, "definition": "CREATE INDEX ar_evidence_retention_state4_v1 ON public.ar_workorder_issue_details USING btree (system_name, country_code, platform, work_order_id) WHERE (status_code = 4)"}, {"live": true, "name": "ar_workorder_analysis_submission_cover_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_analysis_submission_cover_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_date, submitted_at, work_order_id) INCLUDE (payment_order_no, issue_kind, status_code, amount, operated_at) WHERE (system_name = 'AR'::text)"}, {"live": true, "name": "ar_workorder_deposit_original_identity_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_deposit_original_identity_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, upper(NULLIF(btrim(payment_order_no), ''::text))) INCLUDE (work_order_id, payment_order_no) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL))"}, {"live": true, "name": "ar_workorder_deposit_safe_cover_v1_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_deposit_safe_cover_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, work_order_id) INCLUDE (work_order_no, payment_order_no, amount, third_party, channel_type, kyc_connected, status_code, submitted_date, submitted_at, observed_at, utr) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND ((((((((octet_length(COALESCE(country_code, ''::text)) + octet_length(COALESCE(platform, ''::text))) + octet_length(COALESCE(work_order_id, ''::text))) + octet_length(COALESCE(work_order_no, ''::text))) + octet_length(COALESCE(payment_order_no, ''::text))) + octet_length(COALESCE(third_party, ''::text))) + octet_length(COALESCE(channel_type, ''::text))) + octet_length(COALESCE(utr, ''::text))) <= 1500))"}, {"live": true, "name": "ar_workorder_issue_details_operation_v2_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_issue_details_operation_v2_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, operated_at, work_order_id) WHERE (operation_time_source IS NOT NULL)"}, {"live": true, "name": "ar_workorder_issue_details_pkey", "ready": true, "valid": true, "definition": "CREATE UNIQUE INDEX ar_workorder_issue_details_pkey ON public.ar_workorder_issue_details USING btree (system_name, country_code, platform, work_order_id)"}, {"live": true, "name": "ar_workorder_issue_details_submission_v2_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_issue_details_submission_v2_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_date, submitted_at, work_order_id)"}, {"live": true, "name": "ar_workorder_issue_details_submitted_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_issue_details_submitted_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, submitted_at DESC) WHERE (submitted_at IS NOT NULL)"}, {"live": true, "name": "ar_workorder_records_payment_order_no_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_records_payment_order_no_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(payment_order_no))"}, {"live": true, "name": "ar_workorder_records_source_order_no_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_records_source_order_no_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(source_order_no))"}, {"live": true, "name": "ar_workorder_records_utr_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_records_utr_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(utr))"}, {"live": true, "name": "ar_workorder_records_work_order_id_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_records_work_order_id_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(work_order_id))"}, {"live": true, "name": "ar_workorder_records_work_order_no_idx", "ready": true, "valid": true, "definition": "CREATE INDEX ar_workorder_records_work_order_no_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, lower(work_order_no))"}], "forceRls": false, "constraints": [{"name": "ar_workorder_issue_details_amount_check", "validated": true, "definition": "CHECK (((amount >= (0)::numeric) AND ((amount)::text <> ALL (ARRAY['NaN'::text, 'Infinity'::text, '-Infinity'::text]))))"}, {"name": "ar_workorder_issue_details_check", "validated": true, "definition": "CHECK (((operated_at IS NULL) = (operation_time_source IS NULL)))"}, {"name": "ar_workorder_issue_details_country_check", "validated": true, "definition": "CHECK (((length(btrim(country)) >= 1) AND (length(btrim(country)) <= 200)))"}, {"name": "ar_workorder_issue_details_country_code_check", "validated": true, "definition": "CHECK ((country_code ~ '^[A-Z]{2}$'::text))"}, {"name": "ar_workorder_issue_details_issue_kind_check", "validated": true, "definition": "CHECK ((issue_kind = ANY (ARRAY['deposit'::text, 'withdraw'::text])))"}, {"name": "ar_workorder_issue_details_kyc_link_status_code_check", "validated": true, "definition": "CHECK ((kyc_link_status_code >= 0))"}, {"name": "ar_workorder_issue_details_observed_at_check", "validated": true, "definition": "CHECK (isfinite(observed_at))"}, {"name": "ar_workorder_issue_details_operated_at_check", "validated": true, "definition": "CHECK (isfinite(operated_at))"}, {"name": "ar_workorder_issue_details_operation_time_source_check", "validated": true, "definition": "CHECK ((operation_time_source = ANY (ARRAY['operationTime'::text, 'operateTime'::text, 'lastUpdateTime'::text])))"}, {"name": "ar_workorder_issue_details_pkey", "validated": true, "definition": "PRIMARY KEY (system_name, country_code, platform, work_order_id)"}, {"name": "ar_workorder_issue_details_platform_check", "validated": true, "definition": "CHECK (((length(btrim(platform)) >= 1) AND (length(btrim(platform)) <= 200)))"}, {"name": "ar_workorder_issue_details_query_basis_check", "validated": true, "definition": "CHECK ((query_basis = ANY (ARRAY['submission'::text, 'operation'::text])))"}, {"name": "ar_workorder_issue_details_query_date_check", "validated": true, "definition": "CHECK (isfinite(query_date))"}, {"name": "ar_workorder_issue_details_reminder_count_check", "validated": true, "definition": "CHECK ((reminder_count >= 0))"}, {"name": "ar_workorder_issue_details_schema_version_check", "validated": true, "definition": "CHECK ((schema_version = 2))"}, {"name": "ar_workorder_issue_details_source_form_id_check", "validated": true, "definition": "CHECK ((source_form_id >= 0))"}, {"name": "ar_workorder_issue_details_source_pay_type_id_check", "validated": true, "definition": "CHECK ((source_pay_type_id >= 0))"}, {"name": "ar_workorder_issue_details_source_type_code_check", "validated": true, "definition": "CHECK ((source_type_code >= '-1'::integer))"}, {"name": "ar_workorder_issue_details_source_updated_at_check", "validated": true, "definition": "CHECK (isfinite(source_updated_at))"}, {"name": "ar_workorder_issue_details_source_vip_level_check", "validated": true, "definition": "CHECK (((length(source_vip_level) >= 1) AND (length(source_vip_level) <= 32)))"}, {"name": "ar_workorder_issue_details_status_code_check", "validated": true, "definition": "CHECK (((status_code >= 1) AND (status_code <= 5)))"}, {"name": "ar_workorder_issue_details_submitted_at_check", "validated": true, "definition": "CHECK (isfinite(submitted_at))"}, {"name": "ar_workorder_issue_details_submitted_date_check", "validated": true, "definition": "CHECK (isfinite(submitted_date))"}, {"name": "ar_workorder_issue_details_system_name_check", "validated": true, "definition": "CHECK ((system_name = 'AR'::text))"}, {"name": "ar_workorder_issue_details_work_order_id_check", "validated": true, "definition": "CHECK (((length(btrim(work_order_id)) >= 1) AND (length(btrim(work_order_id)) <= 200)))"}, {"name": "ar_workorder_issue_details_work_order_type_id_check", "validated": true, "definition": "CHECK ((work_order_type_id >= 0))"}], "inheritCount": 0}]$tables$::jsonb)loop
  select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'inheritCount',(select count(*)from pg_catalog.pg_inherits i where i.inhparent=c.oid or i.inhrelid=c.oid),
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull)order by a.attnum),'[]'::jsonb)from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)order by ic.relname),'[]'::jsonb)from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated)order by k.conname),'[]'::jsonb)from pg_catalog.pg_constraint k where k.conrelid=c.oid and k.contype<>'n')) into actual_meta
  from pg_catalog.pg_class c where c.oid=to_regclass('public.'||(spec->>'name'));
  if actual_meta is distinct from spec then raise exception 'recovery_source_metadata_drift: %',spec->>'name';end if;
 end loop;

 select count(*)into object_count from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid=f.pronamespace where n.nspname='private'and f.proname in('dashboard_admin_deposit_recovery_cases','dashboard_admin_deposit_recovery_metrics','dashboard_admin_deposit_recovery_statistics','dashboard_admin_deposit_recovery_workorders');
 if object_count not in(0,4)then raise exception 'recovery_partial_installation';end if;
 for spec in select value from jsonb_array_elements($newmeta$[{"signature": "private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)", "md5": "ce99db69086286c9badc7053296c8cbf", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_scope jsonb, p_details boolean DEFAULT false, p_filter jsonb DEFAULT '{}'::jsonb", "cost": 100, "kind": "f", "rows": 1000, "owner": "postgres", "config": ["search_path=\"\""], "result": "TABLE(case_id text, country text, platform text, payment_id text, order_date date, provider text, original_amount numeric, registered_state text, recovery_kind text, recovery_amount numeric, completed_at date, raw_source_rows bigint, duplicate_source_rows bigint, history_progression boolean, conflict boolean, missing_identity boolean, sources jsonb, sources_truncated boolean, source_coverage jsonb, updated_at timestamp with time zone)", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 2}}, {"signature": "private.dashboard_admin_deposit_recovery_metrics(jsonb)", "md5": "388d7578f00336e61bc53db288442240", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_rows jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_deposit_recovery_statistics(jsonb)", "md5": "9b9e912022b019977b419a1e3cfab36e", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_request jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "result": "jsonb", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_deposit_recovery_workorders(jsonb,jsonb)", "md5": "b8f08372a173d0160df5bdae8b749520", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_scope jsonb, p_rows jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\"", "plan_cache_mode=force_custom_plan", "jit=off"], "result": "jsonb", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}]$newmeta$::jsonb)loop
  select md5(f.prosrc),jsonb_build_object('owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid),'language',l.lanname,'volatile',f.provolatile,'secdef',f.prosecdef,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'nargdefaults',f.pronargdefaults,'variadic',f.provariadic::text,'kind',f.prokind) into actual_hash,actual_meta from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(spec->>'signature');
  if object_count=4 and(actual_hash is distinct from spec->>'md5'or actual_meta is distinct from spec->'metadata')then raise exception 'recovery_existing_object_drift: %',spec->>'signature';end if;
 end loop;

 baseline_state:=md5((select prosrc from pg_catalog.pg_proc where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure))='57795c6ea7e81f2bab17b82ff82cff18' and md5((select prosrc from pg_catalog.pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure))='212a33785c64b3266f4eb84de8b0492b';

 patched_state:=md5((select prosrc from pg_catalog.pg_proc where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure))='30030c8a18b0e2153cbb661f63aaebe2' and md5((select prosrc from pg_catalog.pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure))='f4070e4c3b21d717ddd445d7384964f0';
 if not((baseline_state and object_count=0)or(patched_state and object_count=4))then raise exception 'recovery_partial_installation';end if;
 if baseline_state then
-- BEGIN RECOVERY OBJECT recovery-cases.sql
 execute $object$create function private.dashboard_admin_deposit_recovery_cases(p_scope jsonb,p_details boolean default false,p_filter jsonb default '{}'::jsonb)
returns table(case_id text,country text,platform text,payment_id text,order_date date,provider text,original_amount numeric,registered_state text,recovery_kind text,recovery_amount numeric,completed_at date,raw_source_rows bigint,duplicate_source_rows bigint,history_progression boolean,conflict boolean,missing_identity boolean,sources jsonb,sources_truncated boolean,source_coverage jsonb,updated_at timestamptz)
language sql stable security invoker set search_path='' as $fn$
with raw_platforms as materialized (
 select distinct r.platform from public.admin_deposit_issue_rows r where r.country='印度'and r.stale_at is null
 union select distinct r.platform from public.admin_deposit_followup_rows r where r.country='印度'and r.stale_at is null
), platform_keys as materialized (
 select platform raw_platform,private.dashboard_admin_live_deposit_platform_key('IN',platform) platform_key
 from raw_platforms where private.dashboard_scope_allows(p_scope,'IN',platform)and(coalesce(p_filter->>'platform','')in('','all')or private.dashboard_admin_live_deposit_platform_key('IN',platform)=private.dashboard_admin_live_deposit_platform_key('IN',p_filter->>'platform'))
), rows as materialized (
 select 'issue'::text source_kind,r.id source_id,r.source_sheet,r.source_tab,r.source_row,null::bigint source_gid,r.provider raw_provider,k.platform_key platform,
  upper(nullif(btrim(r.order_number),'')) payment_id,r.amount,
  coalesce(nullif(btrim(r.canonical_provider),''),nullif(btrim(r.provider),'')) provider,
  case when r.confirmation_status='已入款' then 'received'when r.confirmation_status in('入其他订单','转其他三方')then'other'when r.status='未入款'then'unreceived'else'unknown'end receipt_state,
  4 source_rank,'unknown'::text recovery_kind,null::numeric recovery_amount,null::date completed_at,false explicit_invalid,
  r.updated_at observed_at
 from public.admin_deposit_issue_rows r join platform_keys k on jsonb_build_array(k.raw_platform)=jsonb_build_array(r.platform) where r.country='印度'and r.stale_at is null and(coalesce(p_filter->>'orderNumber','')=''or strpos(lower(coalesce(upper(nullif(btrim(r.order_number),'')),'')),lower(p_filter->>'orderNumber'))>0)and(not(p_filter?'caseIds')or(p_filter->'caseIds')?md5(jsonb_build_array('IN',k.platform_key,coalesce(upper(nullif(btrim(r.order_number),'')),'ROW:issue:'||r.id))::text))
 union all
 select r.source_kind,r.id,r.source_sheet,r.source_tab,r.source_row,r.source_gid,r.provider,k.platform_key,
  upper(nullif(btrim(r.order_number),'')),r.amount,nullif(btrim(r.provider),''),
  case when r.source_kind='portal' then case lower(btrim(coalesce(r.portal_payload->'entry'->>'outcome','')))when'success'then'received'when'pending'then'unreceived'when'other_order'then'other'when'other_platform'then'other'when'other_id'then'other'when'refund'then'other'else'unknown'end
   else case lower(btrim(coalesce(r.followup_status,'')))when'success'then'received'when'received'then'received'when'成功'then'received'when'成功到账'then'received'when'已到账'then'received'when'已入款'then'received'when'not yet received'then'unreceived'when'pending'then'unreceived'when'尚未收到'then'unreceived'when'未入款'then'unreceived'when'未到账'then'unreceived'when'refund'then'other'when'退款'then'other'when'success to other order'then'other'when'success to other platform'then'other'when'success to other id'then'other'else'unknown'end end,
  case when r.source_kind='portal'then 3 when r.source_sheet='1o0nhJfztjVX9gNwH43uPWg5BUuhBxDMZ-_WUWdRd588'then 2 when r.source_sheet='1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE'then 1 else 0 end,
  case when r.source_kind='portal'and e.valid then e.kind else'unknown'end,
  case when r.source_kind='portal'and e.valid then e.recovered_amount end,
  case when r.source_kind='portal'and e.valid then e.completed_date end,
  r.source_kind='portal'and e.provided and not coalesce(e.valid,false),
  r.updated_at
 from public.admin_deposit_followup_rows r join platform_keys k on jsonb_build_array(k.raw_platform)=jsonb_build_array(r.platform)
 cross join lateral(select coalesce(r.portal_payload->'entry'->>'recoveryKind','unknown')kind,r.portal_payload->'entry'->>'recoveryAmount'amount_text,r.portal_payload->'entry'->>'completedAt'day_text, r.portal_payload->'entry'->>'outcome'outcome) raw
 cross join lateral(select raw.kind,raw.kind<>'unknown'or coalesce(raw.amount_text,'')<>''or coalesce(raw.day_text,'')<>''or(r.portal_payload->'entry'?'recoveryKind'and jsonb_typeof(r.portal_payload->'entry'->'recoveryKind')<>'string')or(r.portal_payload->'entry'?'recoveryAmount'and jsonb_typeof(r.portal_payload->'entry'->'recoveryAmount')<>'string')or(r.portal_payload->'entry'?'completedAt'and jsonb_typeof(r.portal_payload->'entry'->'completedAt')<>'string')provided,
  case when raw.amount_text~'^[0-9]{1,10}(\.[0-9]{1,2})?$'then raw.amount_text::numeric end recovered_amount,
  case when r.source_kind='portal' then private.workorder_receipt_date('RC'||replace(raw.day_text,'-',''))end completed_date) parsed
 cross join lateral(select parsed.*,jsonb_typeof(r.portal_payload->'entry'->'recoveryKind')='string'and jsonb_typeof(r.portal_payload->'entry'->'recoveryAmount')='string'and jsonb_typeof(r.portal_payload->'entry'->'completedAt')='string'and raw.outcome='success'and raw.kind in('unknown','third_party','manual')and parsed.recovered_amount>0 and raw.day_text~'^\d{4}-\d{2}-\d{2}$'and parsed.completed_date::text=raw.day_text and parsed.completed_date<=(now()at time zone'Asia/Kolkata')::date valid) e
 where r.country='印度'and r.stale_at is null and r.source_kind in('sheet','portal') and(coalesce(p_filter->>'orderNumber','')=''or strpos(lower(coalesce(upper(nullif(btrim(r.order_number),'')),'')),lower(p_filter->>'orderNumber'))>0)and(not(p_filter?'caseIds')or(p_filter->'caseIds')?md5(jsonb_build_array('IN',k.platform_key,coalesce(upper(nullif(btrim(r.order_number),'')),'ROW:'||r.source_kind||':'||r.id))::text))
), keyed as materialized (
 select r.*,jsonb_build_array('IN',r.platform,coalesce(r.payment_id,'ROW:'||r.source_kind||':'||r.source_id))::text case_key
 from rows r
), source_cardinality as materialized (
 select case_key,source_kind,source_sheet,count(*) n from keyed group by case_key,source_kind,source_sheet
), duplicate_source_rows as materialized (
 select k.*,case when k.source_kind='issue' then
 jsonb_build_array(i.amount,i.provider,i.canonical_provider,i.utr,i.status,i.confirmation_status,i.match_status,i.kyc_correct,i.utr_match,i.provider_reply,i.upi_id,i.kyc_upi_id)
 else jsonb_build_array(f.amount,f.provider,f.followup_status,f.utr,f.kyc_correct,f.utr_match,f.provider_reply,f.upi_id,f.kyc_upi_id,f.portal_payload->'entry'->'outcome',f.portal_payload->'entry'->'recoveryKind',f.portal_payload->'entry'->'recoveryAmount',f.portal_payload->'entry'->'completedAt')end semantic
 from keyed k join source_cardinality c using(case_key,source_kind,source_sheet)
 left join public.admin_deposit_issue_rows i on k.source_kind='issue'and i.id=k.source_id
 left join public.admin_deposit_followup_rows f on k.source_kind<>'issue'and f.id=k.source_id
 where c.n>1
), source_stats as materialized (
 select k.case_key,k.source_kind,k.source_sheet,k.source_rank,1::bigint n,1::bigint variants,
 case when receipt_state='unknown'then 0 else 1 end::bigint state_variants,
 case when receipt_state<>'unknown'then receipt_state end state,
 case when recovery_amount is not null then 1 else 0 end::bigint recovery_variants,
 case when recovery_kind<>'unknown'then recovery_kind end kind,recovery_amount recovered_amount,completed_at completed_date,explicit_invalid,observed_at,platform,payment_id,amount amount_min,amount amount_max,amount is null original_missing,false original_conflict,coalesce(amount::text in('NaN','Infinity','-Infinity'),false)original_nonfinite,provider provider_min,provider provider_max,false provider_conflict,(payment_id is null or platform is null)missing_identity
 from keyed k join source_cardinality c using(case_key,source_kind,source_sheet)where c.n=1
 union all
 select case_key,source_kind,source_sheet,min(source_rank)source_rank,
 count(*)n,count(distinct semantic)variants,count(distinct receipt_state)filter(where receipt_state<>'unknown')state_variants,
 min(receipt_state)filter(where receipt_state<>'unknown')state,
 count(distinct jsonb_build_array(recovery_kind,recovery_amount,completed_at))filter(where recovery_amount is not null)recovery_variants,
 min(recovery_kind)filter(where recovery_kind<>'unknown')kind,min(recovery_amount)filter(where recovery_amount is not null)recovered_amount,min(completed_at)filter(where recovery_amount is not null)completed_date,
 bool_or(explicit_invalid)explicit_invalid,max(observed_at)observed_at,min(platform),min(payment_id),min(amount),max(amount),bool_or(amount is null),count(distinct coalesce(amount::text,'(missing)'))>1,coalesce(bool_or(amount::text in('NaN','Infinity','-Infinity')),false),min(provider),max(provider),count(distinct provider)>1,bool_or(payment_id is null or platform is null)
 from duplicate_source_rows group by case_key,source_kind,source_sheet
), case_source_stats as materialized (
 select case_key,min(platform)platform,min(payment_id)payment_id,sum(n)::bigint raw_rows,sum(n-variants)duplicates,max(observed_at)observed_at,
 case when not(bool_or(original_conflict)or min(amount_min)::text is distinct from max(amount_max)::text or bool_or(original_missing)and min(amount_min)is not null or bool_or(original_nonfinite))then min(amount_min)end amount,
 case when bool_or(provider_conflict)or min(provider_min)is distinct from max(provider_max)then'来源冲突'else coalesce(min(provider_min),'未提供')end provider,
 bool_or(original_conflict)or min(amount_min)::text is distinct from max(amount_max)::text or bool_or(original_missing)and min(amount_min)is not null or bool_or(original_nonfinite)or bool_or(provider_conflict)or min(provider_min)is distinct from max(provider_max)amount_provider_conflict,
 bool_or(missing_identity)missing_identity,
 max(state)filter(where source_kind='issue'and state_variants=1)issue_state,
 bool_or(source_kind='issue'and variants>1)issue_conflict,
 bool_or(source_kind='portal'and(explicit_invalid or recovery_variants>1 or state_variants>1))portal_conflict,
 count(distinct jsonb_build_array(kind,recovered_amount,completed_date))filter(where source_kind='portal'and kind is not null)portal_variants,
 min(kind)filter(where source_kind='portal')portal_kind,min(recovered_amount)filter(where source_kind='portal')portal_amount,min(completed_date)filter(where source_kind='portal')portal_date,
 case when count(distinct state)filter(where source_kind='portal'and state_variants=1)=1 then min(state)filter(where source_kind='portal'and state_variants=1)end portal_state,
 max(state)filter(where source_kind='sheet'and source_rank=2 and state_variants=1)new_state,
 max(state)filter(where source_kind='sheet'and source_rank=1 and state_variants=1)old_state,
 bool_or(source_kind='sheet'and state_variants>1)sheet_conflict,
 jsonb_agg(jsonb_build_array(source_kind,source_sheet,n,observed_at)order by source_kind,source_sheet)source_coverage
 from source_stats group by case_key
), receipt_prefixes as materialized (
 select distinct case when payment_id~'^RC[0-9]{8}'then left(payment_id,10)else''end prefix from case_source_stats
), receipt_dates as materialized (
 select coalesce(jsonb_object_agg(prefix,private.workorder_receipt_date(prefix)),'{}'::jsonb)dates from receipt_prefixes
), positioned as materialized (
 select k.*,row_number()over(partition by case_key order by source_rank desc,source_sheet,source_row,source_id)source_position from keyed k where p_details
), provenance as materialized (
 select case_key,jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceSheet',source_sheet,'sourceTab',source_tab,'sourceRow',source_row,'sourceGid',source_gid,'sourceId',source_id,'provider',raw_provider,'originalAmount',amount::text,'receiptState',receipt_state,'recoveryKind',recovery_kind,'recoveryAmount',recovery_amount::text,'completedAt',completed_at,'observedAt',observed_at)order by source_position)filter(where source_position<=20)sources
 from positioned group by case_key
), rolled as not materialized (
 select s.*,p.sources from case_source_stats s left join provenance p using(case_key)
), final as (
 select r.*,r.amount_provider_conflict or r.issue_conflict or r.portal_conflict or r.portal_variants>1 or r.missing_identity or coalesce(r.portal_kind is not null and r.issue_state='other',false)
  or coalesce(r.issue_state is null and r.portal_kind is null and r.portal_state is null and (r.sheet_conflict or r.old_state='received'and r.new_state='unreceived'),false)is_conflict,
 r.old_state='unreceived'and(r.new_state='received'or r.issue_state='received'or r.portal_state='received'or r.portal_kind is not null)history_progression,
 case when r.portal_kind is not null then'received'else coalesce(r.issue_state,r.portal_state,r.new_state,r.old_state,'unknown')end receipt_state
 from rolled r
)
select md5(case_key),'印度',platform,payment_id,
 case when rd.receipt_date<=(now()at time zone'Asia/Kolkata')::date then rd.receipt_date end,
 provider,amount,case when is_conflict then'conflict'else receipt_state end,
 case when is_conflict then'unknown'else coalesce(portal_kind,'unknown')end,
 case when not is_conflict then portal_amount end,case when not is_conflict then portal_date end,
 raw_rows,duplicates,coalesce(history_progression,false),coalesce(is_conflict,false),missing_identity,sources,raw_rows>20,source_coverage,observed_at
from final cross join receipt_dates dm cross join lateral(select(dm.dates->>case when payment_id~'^RC[0-9]{8}'then left(payment_id,10)else''end)::date receipt_date offset 0)rd;
$fn$;
$object$;
-- END RECOVERY OBJECT recovery-cases.sql
-- BEGIN RECOVERY OBJECT recovery-metrics.sql
 execute $object$create function private.dashboard_admin_deposit_recovery_metrics(p_rows jsonb)
returns jsonb language sql stable security invoker set search_path='' as $fn$
with r as materialized(select *from jsonb_to_recordset(p_rows)as x(registered_state text,recovery_kind text,original_amount numeric,recovery_amount numeric,raw_source_rows bigint,duplicate_source_rows bigint,history_progression boolean,conflict boolean,missing_identity boolean)),a as(
select count(*)n,count(*)filter(where original_amount is null)missing_original,
 count(*)filter(where registered_state='received')received,
 count(*)filter(where registered_state='unreceived')unreceived,
 count(*)filter(where registered_state='received'and recovery_kind='third_party')third_party,
 count(*)filter(where registered_state='received'and recovery_kind='manual')manual,
 count(*)filter(where registered_state='received'and recovery_kind='unknown')received_unknown,
 count(*)filter(where registered_state in('unknown','other')or missing_identity)unclassified,
 count(*)filter(where conflict)conflicts,
 count(*)filter(where registered_state='received'and recovery_kind='third_party'and recovery_amount is null)third_missing,
 count(*)filter(where registered_state='received'and recovery_kind='manual'and recovery_amount is null)manual_missing,
 coalesce(sum(recovery_amount)filter(where registered_state='received'and recovery_kind='third_party'),0)third_amount,
 coalesce(sum(recovery_amount)filter(where registered_state='received'and recovery_kind='manual'),0)manual_amount
from r)
select jsonb_build_object('registeredOrders',a.n,
 'registeredAmount',case when a.missing_original=0 then(select coalesce(sum(original_amount),0)::text from r)end,
 'knownRegisteredAmount',(select coalesce(sum(original_amount),0)::text from r),'missingOriginalAmountCount',a.missing_original,
 'receivedCount',a.received,'unreceivedCount',a.unreceived,'thirdPartyRecoveredCount',a.third_party,'thirdPartyRecoveredAmount',case when a.third_missing=0 then a.third_amount::text end,
 'manualRecoveredCount',a.manual,'manualRecoveredAmount',case when a.manual_missing=0 then a.manual_amount::text end,
 'receivedUnknownCount',a.received_unknown,'receivedUnknownAmount',case when not exists(select 1 from r where registered_state='received'and recovery_kind='unknown'and original_amount is null)then(select coalesce(sum(original_amount),0)::text from r where registered_state='received'and recovery_kind='unknown')end,
 'remainingUnreceivedCount',a.unreceived,'remainingUnreceivedAmount',case when not exists(select 1 from r where registered_state='unreceived'and original_amount is null)then(select coalesce(sum(original_amount),0)::text from r where registered_state='unreceived')end,
 'unclassifiedCount',a.unclassified,'conflictCount',a.conflicts,
 'differenceCount',case when a.received_unknown+a.unclassified+a.conflicts=0 then a.third_party-a.manual end,
 'differenceAmount',case when a.received_unknown+a.unclassified+a.conflicts+a.third_missing+a.manual_missing=0 then(a.third_amount-a.manual_amount)::text end,
 'rawSourceRows',(select coalesce(sum(raw_source_rows),0)from r),'duplicateSourceRows',(select coalesce(sum(duplicate_source_rows),0)from r),'historyProgressionCount',(select count(*)from r where history_progression),
 'collectedWorkorderCount',null,'processedWorkorderCount',null,'workorderCoverage','not_loaded')from a;
$fn$;
$object$;
-- END RECOVERY OBJECT recovery-metrics.sql
-- BEGIN RECOVERY OBJECT recovery-workorders.sql
 execute $object$-- Owner-only indexed annotations for one already-authorized recovery details page.
-- Completeness refers to this bounded stored-record lookup, never upstream collection.
create function private.dashboard_admin_deposit_recovery_workorders(p_scope jsonb,p_rows jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode=force_custom_plan set jit=off as $fn$
declare v jsonb;e jsonb;
begin
 if p_scope is distinct from private.dashboard_admin_live_scope() then raise exception using errcode='42501',message='recovery_scope_changed';end if;
 if jsonb_typeof(p_rows)is distinct from'array'or octet_length(p_rows::text)>1048576 then raise exception using errcode='22023',message='invalid_recovery_page';end if;
 if jsonb_array_length(p_rows)>100 then raise exception using errcode='22023',message='recovery_page_too_large';end if;
 for e in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(e)is distinct from'object'or e-array['id','platform','orderNumber','originalAmount','currency']<>'{}'::jsonb
   or jsonb_typeof(e->'id')is distinct from'string'or coalesce(e->>'id','')=''or length(e->>'id')>200
   or jsonb_typeof(e->'platform')is distinct from'string'or length(e->>'platform')>200
   or(e?'orderNumber'and jsonb_typeof(e->'orderNumber')not in('string','null'))
   or(e?'originalAmount'and jsonb_typeof(e->'originalAmount')not in('string','null'))
   or(e?'originalAmount'and e->>'originalAmount'is not null and e->>'originalAmount'!~'^-?[0-9]{1,24}(\.[0-9]{1,8})?$')
   or e->>'currency'is distinct from'INR' then raise exception using errcode='22023',message='invalid_recovery_case';end if;
 end loop;
 if(select count(*)<>count(distinct value->>'id')from jsonb_array_elements(p_rows))then raise exception using errcode='22023',message='duplicate_recovery_case';end if;
 with requests as materialized(
  select r.id,private.dashboard_admin_live_deposit_platform_key('IN',r.platform)platform_key,
   upper(nullif(btrim(r."orderNumber"),''))payment_id,r."originalAmount"::numeric expected_amount
  from jsonb_to_recordset(p_rows)r(id text,platform text,"orderNumber"text,"originalAmount"text,currency text)
 ),eligible as materialized(select *from requests where payment_id~'^RC'and expected_amount is not null and platform_key is not null),
 catalog as materialized(
  select p.source_name,p.scope_group country_code,p.country,lower(p.source)system,
   private.dashboard_admin_live_deposit_platform_key('IN',p.source_name)platform_key,
   case when count(distinct coalesce(nullif(btrim(p.currency),''),'(missing)'))=1 then min(nullif(btrim(p.currency),''))end currency
  from private.dashboard_admin_live_platforms()p
  where p.scope_group='IN'and p.country='印度'and lower(p.source)in('ar','newar')
   and private.dashboard_scope_allows(p_scope,p.scope_group,p.source_name)
  group by p.source_name,p.scope_group,p.country,lower(p.source)
 ),ar_targets as materialized(
  select c.platform_key,case when count(distinct coalesce(c.currency,'(missing)'))=1 then min(c.currency)end currency,a.platform from catalog c cross join lateral(
   select c.source_name platform union select c.platform_key
   union select x.platform from(values('82BET'),('82LOTTERY'),('OK.WIN'),('OKWIN'),('VEER.GAME'),('VEERGAME'),('RAJA'),('RAJALOTTERY'),('RAJAGAME'),('RAJAGAMES'),('SHREE.WIN'),('SHREEWIN'))x(platform)
   where private.dashboard_admin_live_deposit_platform_key('IN',x.platform)=c.platform_key
  )a where c.system='ar'and private.dashboard_scope_allows(p_scope,'IN',a.platform)
  group by c.platform_key,a.platform
 ),newar_targets as materialized(
  select distinct c.platform_key,n.platform,n.currency,n.timezone,n.launch_at from catalog c join public.newar_detail_platforms n
   on c.system='newar'and n.platform=c.source_name and n.country_code='IN'and n.country='印度'and n.enabled
  where(n.launch_at is null or n.launch_at<=statement_timestamp())and private.dashboard_scope_allows(p_scope,'IN',n.platform)
 ),ar_rows as materialized(
  select q.id,'ar'::text system,d.platform native_platform,q.platform_key,d.work_order_id workorder_id,d.work_order_no,
   d.status_code::text status_code,coalesce(d.submitted_date,(d.submitted_at at time zone'Asia/Kolkata')::date)submitted_date,
   d.submitted_at,d.observed_at,d.amount,d.currency,d.amount=q.expected_amount and d.currency='INR'and nullif(btrim(d.work_order_id),'')is not null compatible,
   false reference_conflict
  from eligible q cross join lateral(
   select t.currency,d.* from ar_targets t cross join lateral(
    select d.platform,d.work_order_id,d.work_order_no,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.amount
    from public.ar_workorder_issue_details d
    where t.platform_key=q.platform_key and d.system_name='AR'and d.country_code='IN'and d.platform=t.platform and d.issue_kind='deposit'
     and d.payment_order_no is not null and upper(nullif(btrim(d.payment_order_no),''))=q.payment_id
    offset 0
   )d limit 201
  )d
 ),newar_keys as materialized(
  select q.id,q.platform_key,q.payment_id,q.expected_amount,k.id source_pk,k.platform,k.currency target_currency,k.timezone
  from eligible q cross join lateral(
   select x.*from(
    select d.id,t.platform,t.currency,t.timezone from newar_targets t cross join lateral(
     select d.id from public.newar_detail_records d where t.platform_key=q.platform_key and d.platform=t.platform and d.dataset='workorder'
      and d.workorder_type in('存款未到账','存款未到账自动化')and jsonb_typeof(d.raw->'depositOrderNo')='string'
      and md5(upper(nullif(btrim(d.raw->>'depositOrderNo'),'')))=md5(q.payment_id)
      and upper(nullif(btrim(d.raw->>'depositOrderNo'),''))=q.payment_id
      and(t.launch_at is null or d.created_at>=t.launch_at)offset 0 limit 201
    )d
    union
    select d.id,t.platform,t.currency,t.timezone from newar_targets t cross join lateral(
     select d.id from public.newar_detail_records d where t.platform_key=q.platform_key and d.platform=t.platform and d.dataset='workorder'
      and d.workorder_type in('存款未到账','存款未到账自动化')and jsonb_typeof(d.raw->'rechargeNumber')='string'
      and md5(upper(nullif(btrim(d.raw->>'rechargeNumber'),'')))=md5(q.payment_id)
      and upper(nullif(btrim(d.raw->>'rechargeNumber'),''))=q.payment_id
      and(t.launch_at is null or d.created_at>=t.launch_at)offset 0 limit 201
    )d
   )x limit 201
  )k
 ),newar_rows as materialized(
  select k.id,'newar'::text,d.platform,k.platform_key,d.source_id,null::text,d.status_code,
   (d.created_at at time zone k.timezone)::date,d.created_at,d.captured_at,d.amount,d.currency,
   d.amount=k.expected_amount and d.currency=k.target_currency and d.currency='INR'and not r.conflict and nullif(btrim(d.source_id),'')is not null,
   r.conflict
  from newar_keys k cross join lateral(
   select d.platform,d.source_id,d.status_code,d.created_at,d.captured_at,d.amount,d.currency,d.raw
   from public.newar_detail_records d where d.id=k.source_pk and d.platform=k.platform and d.dataset='workorder'offset 0
  )d cross join lateral(select
   case when jsonb_typeof(d.raw->'depositOrderNo')='string'then upper(nullif(btrim(d.raw->>'depositOrderNo'),''))end dep,
   case when jsonb_typeof(d.raw->'rechargeNumber')='string'then upper(nullif(btrim(d.raw->>'rechargeNumber'),''))end ref
  )refs cross join lateral(select
   coalesce(jsonb_typeof(d.raw->'depositOrderNo')not in('string','null'),false)or coalesce(jsonb_typeof(d.raw->'rechargeNumber')not in('string','null'),false)
    or coalesce(refs.dep is not null and refs.ref is not null and refs.dep<>refs.ref,false)conflict
  )r
 ),all_rows as materialized(select *from ar_rows union all select *from newar_rows),
 pool as materialized(select id,count(*)n,bool_or(not coalesce(compatible,false))bad from all_rows group by id),
 native_caps as materialized(
  select id,bool_or(n>=201)capped from(select id,count(*)n from ar_rows group by id union all select id,count(*)from newar_keys group by id)x group by id
 ),workorders as materialized(
  select id,system,platform_key,workorder_id,array_agg(distinct native_platform order by native_platform)native_platforms,
   case when count(distinct work_order_no)=1 then min(work_order_no)end work_order_no,
   case when count(distinct coalesce(status_code,'(missing)'))=1 then min(status_code)end status_code,
   case when count(distinct coalesce(submitted_date::text,'(missing)'))=1 then min(submitted_date)end submitted_date,
   min(submitted_at)submitted_at,max(observed_at)observed_at,min(amount)amount,min(currency)currency
  from all_rows where compatible and coalesce(workorder_id,'')<>''group by id,system,platform_key,workorder_id
 ),numbered as materialized(select w.*,row_number()over(partition by id order by system,workorder_id)pos from workorders w),
 totals as materialized(select id,count(*)n,count(*)filter(where status_code='4')processed,bool_or(status_code is null or status_code not in('1','2','3','4','5'))unknown_status from workorders group by id),
 annotations as(
  select q.id,
   e.id is not null and(exists(select 1 from ar_targets c where c.platform_key=q.platform_key and c.currency='INR')or exists(select 1 from newar_targets c where c.platform_key=q.platform_key and c.currency='INR'))authorized,
   e.id is not null and(exists(select 1 from ar_targets c where c.platform_key=q.platform_key and c.currency='INR')or exists(select 1 from newar_targets c where c.platform_key=q.platform_key and c.currency='INR'))
    and not coalesce(p.bad,false)and not coalesce(c.capped,false)and coalesce(t.n,0)<=200 complete,
   coalesce(t.n,0)n,coalesce(t.processed,0)processed,coalesce(t.unknown_status,false)unknown_status,
   coalesce(p.n,0)candidate_count,coalesce(c.capped,false)candidate_truncated
  from requests q left join eligible e using(id)left join pool p using(id)left join native_caps c using(id)left join totals t using(id)
 )
 select coalesce(jsonb_object_agg(a.id,jsonb_build_object(
  'collectedWorkorderCount',case when a.complete then a.n end,
  'processedWorkorderCount',case when a.complete and not a.unknown_status then a.processed end,
  'workorderCoverage',case when not a.authorized then'not_loaded'when a.complete and not a.unknown_status then'complete'else'partial'end,
  'workorderCoverageLabel','仅当前页原单按完整原单号、平台、币种和金额关联的已入库工单；工单已处理不代表到账，未核实源采集完整性',
  'upstreamComplete',false,'matchedWorkorderCount',a.n,'unknownWorkorderStatus',a.unknown_status,
  'workordersTruncated',a.candidate_truncated or a.n>200,'candidateWorkorderRows',a.candidate_count,
  'collectedWorkorders',coalesce((select jsonb_agg(jsonb_build_object(
    'sourceSystem',n.system,'nativePlatforms',n.native_platforms,'workOrderId',n.workorder_id,'workOrderNo',n.work_order_no,
    'statusCode',n.status_code,'processing',case n.status_code when'4'then'processed'when'3'then'rejected'when'1'then'unprocessed'when'2'then'unprocessed'when'5'then'unprocessed'else'unknown'end,
    'sourceWorkorderState',case n.status_code when'4'then'已处理'when'3'then'已驳回'when'1'then'未处理'when'2'then'未处理'when'5'then'未处理'else'待核实'end,
    'submittedDate',n.submitted_date,'submittedAt',n.submitted_at,'observedAt',n.observed_at,'amount',n.amount::text,'currency',n.currency)
    order by n.system,n.workorder_id)from numbered n where n.id=a.id and n.pos<=200),'[]'::jsonb)
 )),'{}'::jsonb)into v from annotations a;
 return v;
end;$fn$;
revoke all on function private.dashboard_admin_deposit_recovery_workorders(jsonb,jsonb)from public,anon,authenticated,service_role;

$object$;
-- END RECOVERY OBJECT recovery-workorders.sql
-- BEGIN RECOVERY OBJECT recovery-query.sql
 execute $object$create function private.dashboard_admin_deposit_recovery_statistics(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode=force_custom_plan as $fn$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_access jsonb;v_view text:=coalesce(p_request->>'view','summary');v_dates text:=coalesce(p_request->>'dateMode','all');v_state text:=coalesce(p_request->>'recoveryState','all');v_from date;v_to date;v_offset integer:=0;v_limit integer:=20;v_export boolean:=false;v_result jsonb;v_key text;v_annotations jsonb;v_page_keys jsonb;v_needed text[];v_sources jsonb;
begin
 if jsonb_typeof(p_request)is distinct from'object'or octet_length(p_request::text)>12000 or p_request-array['section','view','country','dateMode','startAt','endAt','platform','provider','orderNumber','recoveryState','offset','limit','export']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 for v_key in select unnest(array['section','view','country','dateMode','startAt','endAt','platform','provider','orderNumber','recoveryState'])loop
  if p_request?v_key and(jsonb_typeof(p_request->v_key)is distinct from'string'or length(p_request->>v_key)>200 or p_request->>v_key~'[[:cntrl:]]')then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if p_request->>'section'is distinct from'recovery'or v_view not in('summary','details')or v_dates not in('all','range')or coalesce(p_request->>'country','')not in('','all','印度','IN')or v_state not in('all','third_party','manual','received_unknown','unreceived','conflict')then raise exception using errcode='22023',message='invalid_view';end if;
 if p_request?'export'then if jsonb_typeof(p_request->'export')is distinct from'boolean'then raise exception using errcode='22023',message='invalid_export';end if;v_export:=(p_request->>'export')::boolean;end if;
 v_access:=private.dashboard_role_access();v_needed:=array['deposit_statistics.view','deposit_statistics.query'];
 if v_view='details'or v_export then v_needed:=array_append(v_needed,'deposit_statistics.detail');end if;
 if v_export then v_needed:=array_append(v_needed,'deposit_statistics.export');end if;
 if not coalesce(v_access->>'mode'='owner'or v_access->>'mode'='assigned'and((v_access->'permissions')?&v_needed),false)then raise exception using errcode='42501',message='role_permission_denied';end if;
 for v_key in select unnest(array['offset','limit'])loop
  if p_request?v_key and(jsonb_typeof(p_request->v_key)is distinct from'number'or p_request->>v_key!~'^[0-9]{1,7}$')then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 if v_offset>1000000 or v_limit not in(20,50,100)then raise exception using errcode='22023',message='invalid_pagination';end if;
 if v_dates='range'then
  if coalesce(p_request->>'startAt','')!~'^\d{4}-\d{2}-\d{2}T'or coalesce(p_request->>'endAt','')!~'^\d{4}-\d{2}-\d{2}T'then raise exception using errcode='22023',message='invalid_dates';end if;
  v_from:=left(p_request->>'startAt',10)::date;v_to:=left(p_request->>'endAt',10)::date;
  if v_from>v_to or v_to-v_from>366 then raise exception using errcode='22023',message='invalid_dates';end if;
 end if;
 with cases as materialized(
 select c.*,case when c.conflict then'conflict'when c.registered_state='received'then case c.recovery_kind when'third_party'then'third_party'when'manual'then'manual'else'received_unknown'end when c.registered_state='unreceived'then'unreceived'else'unknown'end recovery_state
 from private.dashboard_admin_deposit_recovery_cases(v_scope,false,p_request)c
 ),filtered as materialized(
 select *from cases c where(v_dates='all'or c.order_date between v_from and v_to)
 and(coalesce(p_request->>'platform','')in('','all')or c.platform=private.dashboard_admin_live_deposit_platform_key('IN',p_request->>'platform'))
 and(coalesce(p_request->>'provider','')in('','all')or c.provider=p_request->>'provider')
 and(coalesce(p_request->>'orderNumber','')=''or strpos(lower(coalesce(c.payment_id,'')),lower(p_request->>'orderNumber'))>0)
 and(v_state='all'or c.recovery_state=v_state)
 ),folded as materialized(
 select order_date,provider,grouping(order_date)gd,grouping(provider)gp,count(*)n,max(updated_at)observed_at,
 count(*)filter(where original_amount is null)missing_original,coalesce(sum(original_amount),0)known_amount,
 count(*)filter(where registered_state='received')received,count(*)filter(where registered_state='unreceived')unreceived,
 count(*)filter(where registered_state='received'and recovery_kind='third_party')third_party,
 count(*)filter(where registered_state='received'and recovery_kind='manual')manual,
 count(*)filter(where registered_state='received'and recovery_kind='unknown')received_unknown,
 count(*)filter(where registered_state in('unknown','other')or missing_identity)unclassified,
 count(*)filter(where conflict)conflicts,
 count(*)filter(where registered_state='received'and recovery_kind='third_party'and recovery_amount is null)third_missing,
 count(*)filter(where registered_state='received'and recovery_kind='manual'and recovery_amount is null)manual_missing,
 count(*)filter(where registered_state='received'and recovery_kind='unknown'and original_amount is null)unknown_missing,
 count(*)filter(where registered_state='unreceived'and original_amount is null)remaining_missing,
 coalesce(sum(recovery_amount)filter(where registered_state='received'and recovery_kind='third_party'),0)third_amount,
 coalesce(sum(recovery_amount)filter(where registered_state='received'and recovery_kind='manual'),0)manual_amount,
 coalesce(sum(original_amount)filter(where registered_state='received'and recovery_kind='unknown'),0)unknown_amount,
 coalesce(sum(original_amount)filter(where registered_state='unreceived'),0)remaining_amount,
 coalesce(sum(raw_source_rows),0)raw_rows,coalesce(sum(duplicate_source_rows),0)duplicate_rows,
 count(*)filter(where history_progression)progressions
 from filtered group by grouping sets((),(order_date),(provider))
),metrics as materialized(
 select a.*,jsonb_build_object('registeredOrders',a.n,
 'registeredAmount',case when a.missing_original=0 then a.known_amount::text end,
 'knownRegisteredAmount',a.known_amount::text,'missingOriginalAmountCount',a.missing_original,
 'receivedCount',a.received,'unreceivedCount',a.unreceived,'thirdPartyRecoveredCount',a.third_party,'thirdPartyRecoveredAmount',case when a.third_missing=0 then a.third_amount::text end,
 'manualRecoveredCount',a.manual,'manualRecoveredAmount',case when a.manual_missing=0 then a.manual_amount::text end,
 'receivedUnknownCount',a.received_unknown,'receivedUnknownAmount',case when a.unknown_missing=0 then a.unknown_amount::text end,
 'remainingUnreceivedCount',a.unreceived,'remainingUnreceivedAmount',case when a.remaining_missing=0 then a.remaining_amount::text end,
 'unclassifiedCount',a.unclassified,'conflictCount',a.conflicts,
 'differenceCount',case when a.received_unknown+a.unclassified+a.conflicts=0 then a.third_party-a.manual end,
 'differenceAmount',case when a.received_unknown+a.unclassified+a.conflicts+a.third_missing+a.manual_missing=0 then(a.third_amount-a.manual_amount)::text end,
 'rawSourceRows',a.raw_rows,'duplicateSourceRows',a.duplicate_rows,'historyProgressionCount',a.progressions,
 'collectedWorkorderCount',null,'processedWorkorderCount',null,'workorderCoverage','not_loaded')value from folded a
),stats as materialized(select value,n,observed_at from metrics where gd=1 and gp=1),
 daily as materialized(select order_date,value||jsonb_build_object('date',order_date)value from metrics where gd=0 and gp=1),
 providers as materialized(select provider,value||jsonb_build_object('provider',provider)value from metrics where gd=1 and gp=0),
 page as materialized(select *from filtered c order by order_date desc nulls last,platform,payment_id nulls last,case_id offset(case when v_export then 0 else v_offset end)limit(case when v_export then 50001 else v_limit end)),
 source_counts as materialized(
 select x->>0 "sourceKind",x->>1 "sourceSheet",sum((x->>2)::bigint)raw_rows,max((x->>3)::timestamptz)observed_at
 from filtered c cross join lateral jsonb_array_elements(c.source_coverage)x group by 1,2
 )
 select jsonb_build_object('version',1,'section','recovery','source','google-followups-and-portal','dateBasis','rc_receipt_date','view',v_view,'summary',stats.value,
 'daily',coalesce((select jsonb_agg(value order by order_date nulls last)from daily),'[]'::jsonb),'providers',coalesce((select jsonb_agg(value order by provider)from providers),'[]'::jsonb),
 'rows',case when v_view='details'or v_export then coalesce((select jsonb_agg(case when v_export then jsonb_build_object('id',case_id,'platform',platform,'orderNumber',payment_id,'orderDate',order_date,'provider',provider,'originalAmount',original_amount::text,'currency','INR','recoveryKind',recovery_kind,'recoveryAmount',recovery_amount::text,'completedAt',completed_at,'recoveryState',recovery_state,'rawSourceRows',raw_source_rows)else jsonb_build_object('id',case_id,'country',country,'platform',platform,'orderNumber',payment_id,'orderDate',order_date,'provider',provider,'originalAmount',original_amount::text,'currency','INR','registeredState',registered_state,'recoveryKind',recovery_kind,'recoveryAmount',recovery_amount::text,'completedAt',completed_at,'recoveryState',recovery_state,'rawSourceRows',raw_source_rows,'duplicateSourceRows',duplicate_source_rows,'historyProgression',history_progression,'sources',case when v_export then'[]'::jsonb else coalesce(sources,'[]'::jsonb)end,'sourcesTruncated',sources_truncated,'collectedWorkorderCount',null,'processedWorkorderCount',null,'collectedWorkorders','[]'::jsonb,'workorderCoverage','not_loaded','evidenceBasis',case when recovery_kind<>'unknown'then'explicit_portal_recovery'else'google_or_portal_registered_state'end)end order by order_date desc nulls last,platform,payment_id nulls last,case_id)from page),'[]'::jsonb)else'[]'::jsonb end,
 'total',stats.n,'offset',case when v_export then 0 else v_offset end,'limit',case when v_export then 50000 else v_limit end,'exportComplete',v_export,'updatedAt',stats.observed_at,
 'coverage',jsonb_build_object('complete',false,'label','登记记录与补单证据；采集完整性、实际到账仍未验证','methodComplete',coalesce((stats.value->>'receivedUnknownCount')::bigint,0)+coalesce((stats.value->>'unclassifiedCount')::bigint,0)+coalesce((stats.value->>'conflictCount')::bigint,0)=0,'unknownMethodCount',(stats.value->'receivedUnknownCount'),'missingIdentityCount',(select count(*)from filtered where missing_identity),'aggregateTruncated',false,'aggregateMaxGroups',5000,'exportMaxRows',50000,'exportMaxBytes',16777216,'sources',coalesce((select jsonb_agg(jsonb_build_object('sourceKind',"sourceKind",'sourceSheet',"sourceSheet",'rawRows',raw_rows,'lastObservedAt',observed_at)order by "sourceKind","sourceSheet")from source_counts),'[]'::jsonb)),
 '_dailyCount',(select count(*)from daily),'_providerCount',(select count(*)from providers))into v_result from stats;
 if(v_result->>'_dailyCount')::bigint>5000 or(v_result->>'_providerCount')::bigint>5000 then raise exception using errcode='22023',message='recovery_aggregate_too_large';end if;
 v_result:=v_result-array['_dailyCount','_providerCount'];
 if v_export and(v_result->>'total')::bigint>50000 then raise exception using errcode='22023',message='export_too_large';end if;
 if v_view='details'and not v_export then
  select coalesce(jsonb_agg(jsonb_build_object('id',r->'id','platform',r->'platform','orderNumber',r->'orderNumber','originalAmount',r->'originalAmount','currency',r->'currency')),'[]'::jsonb)into v_page_keys from jsonb_array_elements(v_result->'rows')r where jsonb_typeof(r->'platform')='string'and nullif(r->>'platform','')is not null;
  select coalesce(jsonb_object_agg(c.case_id,coalesce(c.sources,'[]'::jsonb)),'{}'::jsonb)into v_sources
  from private.dashboard_admin_deposit_recovery_cases(v_scope,true,jsonb_build_object('caseIds',(select coalesce(jsonb_agg(r->'id'),'[]'::jsonb)from jsonb_array_elements(v_result->'rows')r)))c;
  if jsonb_array_length(v_page_keys)>0 then v_annotations:=private.dashboard_admin_deposit_recovery_workorders(v_scope,v_page_keys);else v_annotations:='{}'::jsonb;end if;
  select jsonb_set(v_result,'{rows}',coalesce(jsonb_agg(r.value||jsonb_build_object('sources',coalesce(v_sources->(r.value->>'id'),'[]'::jsonb))||coalesce(v_annotations->(r.value->>'id'),'{}'::jsonb)order by r.position),'[]'::jsonb))into v_result from jsonb_array_elements(v_result->'rows')with ordinality r(value,position);
 end if;
 if octet_length(v_result::text)>16777216 then raise exception using errcode='22023',message='export_payload_too_large';end if;
 return v_result;
end;
$fn$;
$object$;
-- END RECOVERY OBJECT recovery-query.sql
 revoke all on function private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb),private.dashboard_admin_deposit_recovery_metrics(jsonb),private.dashboard_admin_deposit_recovery_statistics(jsonb),private.dashboard_admin_deposit_recovery_workorders(jsonb,jsonb) from public,anon,authenticated,service_role;
 select pg_get_functiondef('private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure)into definition;
 if (length(definition)-length(replace(definition,$old$
begin
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_collected_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$old$,'')))/length($old$
begin
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_collected_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$old$)<>1 then raise exception 'recovery_anchor_drift';end if;
 execute replace(definition,$old$
begin
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_collected_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$old$,$new$
begin
 if p_request->>'section'='recovery' then return private.dashboard_admin_deposit_recovery_statistics(p_request);end if;
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_collected_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$new$);
 select pg_get_functiondef('public.dashboard_admin_execute(text,jsonb)'::regprocedure)into definition;
 if (length(definition)-length(replace(definition,$old$
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
end;$old$,'')))/length($old$
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
end;$old$)<>1 then raise exception 'recovery_anchor_drift';end if;
 execute replace(definition,$old$
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
end;$old$,$new$
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
  or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders' or p_request->>'section'='recovery' and (p_request->>'view'='details' or p_request->'export'='true'::jsonb))
  or action='depositIssues' and p_page='deposit_statistics'
 then needed:=array_append(needed,p_page||'.detail');end if;
 if action='depositStatistics'and p_request->>'section'='recovery'and p_request->'export'='true'::jsonb then needed:=array_append(needed,p_page||'.export');end if;
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
end;$new$);
 end if;

 for spec in select value from jsonb_array_elements($deps$[{"signature": "private.dashboard_scope_allows(jsonb,text,text)", "md5": "87042edcedc3200c559a821250de831e", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}", "args": "p_scope jsonb, p_country text, p_platform text DEFAULT ''::text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "boolean", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 1}}, {"signature": "private.dashboard_admin_live_scope()", "md5": "bab25103334aa222d6220a27881ce000", "metadata": {"acl": "{postgres=X/postgres}", "args": "", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_live_deposit_platform_key(text,text)", "md5": "e2d393715ea9c1354e5a5cfc5340e39b", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_country text, p_name text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "text", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.workorder_receipt_date(text)", "md5": "7d9dfcd7036f11bf5dd257f4ea36e808", "metadata": {"acl": "{postgres=X/postgres,service_role=X/postgres}", "args": "p_order text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "date", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_deposit_statistics(jsonb)", "md5": "57795c6ea7e81f2bab17b82ff82cff18", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres}", "args": "p_request jsonb DEFAULT '{}'::jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\"", "statement_timeout=20s"], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 1}}, {"signature": "private.dashboard_role_access()", "md5": "423aab3bb0ec685aa745a18ea6b7811a", "metadata": {"acl": "{postgres=X/postgres}", "args": "", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "public.dashboard_admin_execute(text,jsonb)", "md5": "212a33785c64b3266f4eb84de8b0492b", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres}", "args": "p_page text, p_request jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "v", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_live_platforms()", "md5": "9423bd69a95d21c9e6740c6709492395", "metadata": {"acl": "{postgres=X/postgres,authenticated=X/postgres}", "args": "", "cost": 100, "kind": "f", "rows": 1000, "owner": "postgres", "config": ["search_path=\"\""], "result": "TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)", "secdef": true, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_live_withdraw_key(text)", "md5": "440671f01a670ad05695e9b8692888a3", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_name text", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "text", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "i", "leakproof": false, "nargdefaults": 0}}]$deps$::jsonb)loop
  select md5(f.prosrc),jsonb_build_object('owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid),'language',l.lanname,'volatile',f.provolatile,'secdef',f.prosecdef,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'nargdefaults',f.pronargdefaults,'variadic',f.provariadic::text,'kind',f.prokind) into actual_hash,actual_meta from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(spec->>'signature');
  if actual_hash is null or actual_meta is distinct from spec->'metadata' then raise exception 'recovery_dependency_metadata_drift: %',spec->>'signature';end if;
  if spec->>'signature' in ('private.dashboard_admin_deposit_statistics(jsonb)','public.dashboard_admin_execute(text,jsonb)')then
   if actual_hash not in (case when spec->>'signature'='private.dashboard_admin_deposit_statistics(jsonb)'then '57795c6ea7e81f2bab17b82ff82cff18'else '212a33785c64b3266f4eb84de8b0492b'end,case when spec->>'signature'='private.dashboard_admin_deposit_statistics(jsonb)'then '30030c8a18b0e2153cbb661f63aaebe2'else 'f4070e4c3b21d717ddd445d7384964f0'end)then raise exception 'recovery_dependency_body_drift: %',spec->>'signature';end if;
  elsif actual_hash<>spec->>'md5' then raise exception 'recovery_dependency_body_drift: %',spec->>'signature';end if;
 end loop;
 if md5((select prosrc from pg_catalog.pg_proc where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure))<>'30030c8a18b0e2153cbb661f63aaebe2'then raise exception 'recovery_postcondition_drift';end if;
 if md5((select prosrc from pg_catalog.pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure))<>'f4070e4c3b21d717ddd445d7384964f0'then raise exception 'recovery_postcondition_drift';end if;

 select count(*)into object_count from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid=f.pronamespace where n.nspname='private'and f.proname in('dashboard_admin_deposit_recovery_cases','dashboard_admin_deposit_recovery_metrics','dashboard_admin_deposit_recovery_statistics','dashboard_admin_deposit_recovery_workorders');
 if object_count not in(0,4)then raise exception 'recovery_partial_installation';end if;
 for spec in select value from jsonb_array_elements($newmeta$[{"signature": "private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)", "md5": "ce99db69086286c9badc7053296c8cbf", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_scope jsonb, p_details boolean DEFAULT false, p_filter jsonb DEFAULT '{}'::jsonb", "cost": 100, "kind": "f", "rows": 1000, "owner": "postgres", "config": ["search_path=\"\""], "result": "TABLE(case_id text, country text, platform text, payment_id text, order_date date, provider text, original_amount numeric, registered_state text, recovery_kind text, recovery_amount numeric, completed_at date, raw_source_rows bigint, duplicate_source_rows bigint, history_progression boolean, conflict boolean, missing_identity boolean, sources jsonb, sources_truncated boolean, source_coverage jsonb, updated_at timestamp with time zone)", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 2}}, {"signature": "private.dashboard_admin_deposit_recovery_metrics(jsonb)", "md5": "388d7578f00336e61bc53db288442240", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_rows jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\""], "result": "jsonb", "secdef": false, "strict": false, "language": "sql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_deposit_recovery_statistics(jsonb)", "md5": "9b9e912022b019977b419a1e3cfab36e", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_request jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "result": "jsonb", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}, {"signature": "private.dashboard_admin_deposit_recovery_workorders(jsonb,jsonb)", "md5": "b8f08372a173d0160df5bdae8b749520", "metadata": {"acl": "{postgres=X/postgres}", "args": "p_scope jsonb, p_rows jsonb", "cost": 100, "kind": "f", "rows": 0, "owner": "postgres", "config": ["search_path=\"\"", "plan_cache_mode=force_custom_plan", "jit=off"], "result": "jsonb", "secdef": false, "strict": false, "language": "plpgsql", "parallel": "u", "variadic": "0", "volatile": "s", "leakproof": false, "nargdefaults": 0}}]$newmeta$::jsonb)loop
  select md5(f.prosrc),jsonb_build_object('owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid),'language',l.lanname,'volatile',f.provolatile,'secdef',f.prosecdef,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'nargdefaults',f.pronargdefaults,'variadic',f.provariadic::text,'kind',f.prokind) into actual_hash,actual_meta from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(spec->>'signature');
  if object_count=4 and(actual_hash is distinct from spec->>'md5'or actual_meta is distinct from spec->'metadata')then raise exception 'recovery_existing_object_drift: %',spec->>'signature';end if;
 end loop;
 if object_count<>4 then raise exception 'recovery_postcondition_drift';end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
