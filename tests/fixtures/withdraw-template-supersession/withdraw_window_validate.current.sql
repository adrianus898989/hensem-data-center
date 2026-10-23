CREATE OR REPLACE FUNCTION private.withdraw_window_validate(q jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
END;$function$
