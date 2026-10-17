-- Local wall-clock request contract, independent windows; Z is the existing
-- withdrawal endpoint's date carrier, never a claim that each platform is UTC.
CREATE FUNCTION private.withdraw_window_validate(q jsonb)RETURNS void LANGUAGE plpgsql STABLE SET search_path=''AS $$
DECLARE k text;a timestamp;b timestamp;
BEGIN
 IF q IS NULL OR jsonb_typeof(q)<>'object'OR q->'windowVersion'IS DISTINCT FROM'2'::jsonb OR coalesce(q->>'successBasis','')NOT IN('success','source_updated')THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_contract';END IF;
 FOREACH k IN ARRAY ARRAY['startAt','endAt','successStartAt','successEndAt']LOOP
  IF jsonb_typeof(q->k)IS DISTINCT FROM'string'OR q->>k!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.]000)?Z$'THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_time';END IF;
  a:=left(q->>k,19)::timestamp;
  IF to_char(a,'YYYY-MM-DD"T"HH24:MI:SS')<>left(q->>k,19)THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_time';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['','success']LOOP
  a:=left(q->>(CASE WHEN k=''THEN'startAt'ELSE'successStartAt'END),19)::timestamp;b:=left(q->>(CASE WHEN k=''THEN'endAt'ELSE'successEndAt'END),19)::timestamp;
  IF a>b OR b::date-a::date>30 THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_range';END IF;
 END LOOP;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_time';
END;$$;
CREATE FUNCTION private.withdraw_window_created_local(q jsonb,t timestamp)RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 WITH w AS(SELECT left(q->>'startAt',19)::timestamp a,left(q->>'endAt',19)::timestamp+interval'1second'b,(left(q->>'endAt',10)::date-left(q->>'startAt',10)::date+1)*interval'1day'd)
 SELECT isfinite(t)AND((t>=a AND t<b)OR(t>=a-d AND t<b-d))FROM w;
$$;
CREATE FUNCTION private.withdraw_window_created(q jsonb,t timestamptz,z text)RETURNS boolean LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT private.withdraw_window_created_local(q,t AT TIME ZONE z);
$$;
CREATE FUNCTION private.withdraw_window_whole_days(q jsonb)RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT substring(q->>'startAt'FROM 12 FOR 8)='00:00:00'AND substring(q->>'endAt'FROM 12 FOR 8)='23:59:59';
$$;
-- Availability refers to source-order timestamps, never bank settlement.
-- Audit/operated/observed/received/stored clocks are deliberately excluded.
CREATE FUNCTION private.withdraw_window_capability(s text,b text)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT CASE
 WHEN s='kb'AND b='success'THEN jsonb_build_object('available',true,'field','completed_at','meaning','source_order_completed')
 WHEN s='newar'AND b='success'THEN jsonb_build_object('available',true,'field','success_at','meaning','source_order_success')
 WHEN s='newar'AND b='source_updated'THEN jsonb_build_object('available',true,'field','source_updated_at','meaning','source_order_updated')
 WHEN s='duoli'AND b='source_updated'THEN jsonb_build_object('available',true,'field','updated_at','meaning','source_order_updated')
 WHEN s='game66'AND b='source_updated'THEN jsonb_build_object('available',true,'field','update_time','meaning','source_order_updated')
 WHEN s='lg'AND b='success'THEN jsonb_build_object('available',true,'field','paid_at','meaning','source_order_paid')
 ELSE jsonb_build_object('available',false,'field',null,'reason',CASE
  WHEN s='ar'AND b='success'THEN'source_completion_semantics_unverified'
  WHEN b='source_updated'THEN'source_update_time_unavailable'
  ELSE'payment_success_time_unavailable'END)
 END||jsonb_build_object('paymentSettlementTime',false);
$$;
REVOKE ALL ON FUNCTION private.withdraw_window_validate(jsonb),private.withdraw_window_created_local(jsonb,timestamp),private.withdraw_window_created(jsonb,timestamptz,text),private.withdraw_window_whole_days(jsonb),private.withdraw_window_capability(text,text)FROM public,anon,authenticated,service_role;

CREATE FUNCTION private.withdraw_window_legacy(q jsonb)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT q-ARRAY['windowVersion','successStartAt','successEndAt','successBasis'];
$$;
CREATE FUNCTION private.withdraw_window_default_day(q jsonb,d date)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT q||jsonb_build_object('startAt',d::text||'T00:00:00.000Z','endAt',d::text||'T23:59:59.000Z','successStartAt',d::text||'T00:00:00.000Z','successEndAt',d::text||'T23:59:59.000Z','windowVersion',2,'successBasis',coalesce(q->>'successBasis','success'));
$$;
REVOKE ALL ON FUNCTION private.withdraw_window_legacy(jsonb),private.withdraw_window_default_day(jsonb,date)FROM public,anon,authenticated,service_role;
