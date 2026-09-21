-- Preserve an explicitly captured/corrected manual provider across older collectors'
-- later blank uploads. Named providers and status changes still use new source data.
CREATE OR REPLACE FUNCTION public.publish_ar_collected_orders(p_token_hash text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 cred jsonb; scope_count integer; allowed constant jsonb := '[{"country_code":"PK","platform":"92PKR"},{"country_code":"PK","platform":"92R"},{"country_code":"PK","platform":"92DADU"},{"country_code":"PK","platform":"92GO"},{"country_code":"PK","platform":"92COCO"},{"country_code":"PK","platform":"92GLORY"},{"country_code":"PK","platform":"92STRIKE"},{"country_code":"PK","platform":"92STAR"},{"country_code":"PK","platform":"92.GAME"},{"country_code":"PK","platform":"YAYWIN"},{"country_code":"BR","platform":"POPBRA"},{"country_code":"BR","platform":"POPPG"},{"country_code":"BR","platform":"POP555"},{"country_code":"BR","platform":"POP678"},{"country_code":"BR","platform":"POP888"},{"country_code":"BR","platform":"POPLUA"},{"country_code":"BR","platform":"POPBEM"},{"country_code":"BR","platform":"POPCEU"},{"country_code":"VN","platform":"92LOTTERY"},{"country_code":"VN","platform":"VN168"},{"country_code":"VN","platform":"66CLUB"},{"country_code":"VN","platform":"82VN"},{"country_code":"ID","platform":"55FIVE"},{"country_code":"MY","platform":"MZPLAY"},{"country_code":"MM","platform":"6LOTTERY"},{"country_code":"NG","platform":"FB999"},{"country_code":"IN","platform":"91CLUB"},{"country_code":"IN","platform":"55CLUB"},{"country_code":"IN","platform":"IN999"},{"country_code":"IN","platform":"OKWIN"},{"country_code":"IN","platform":"JALWA"},{"country_code":"IN","platform":"BIGMUMBAI"},{"country_code":"IN","platform":"82LOTTERY"},{"country_code":"IN","platform":"LOTTERY7"},{"country_code":"IN","platform":"51GAME"},{"country_code":"IN","platform":"6CLUB"},{"country_code":"IN","platform":"TPPLAY"},{"country_code":"IN","platform":"RAJA"},{"country_code":"IN","platform":"JAICLUB"},{"country_code":"IN","platform":"Shree.Win"},{"country_code":"IN","platform":"Veer.Game"}]'::jsonb;
 r jsonb; k text; bid uuid; stamp timestamptz; fingerprint text; prior_hash text; n integer;
BEGIN
 SELECT allowed_scopes INTO cred FROM public.ar_business_direct_credentials
 WHERE token_hash=p_token_hash AND NOT revoked AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='ARO_AUTH_INVALID'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>1048576 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD';
 END IF;
 SELECT count(*) INTO scope_count FROM jsonb_array_elements(allowed) a
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cred) c WHERE c->>'country_code'=a->>'country_code' AND c->>'platform'=a->>'platform');
 IF scope_count=0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ARO_SCOPE_DENIED'; END IF;
 IF p_payload->>'action'='check' THEN
   IF p_payload<>jsonb_build_object('action','check') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD'; END IF;
   RETURN jsonb_build_object('ok',true,'source_system','AR','details_version',1,'scope_count',scope_count);
 END IF;
 IF p_payload->>'action' IS DISTINCT FROM 'ingest' OR p_payload->>'source_system' IS DISTINCT FROM 'AR'
   OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>8
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) f(key) WHERE f.key<>ALL(ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at','orders'])) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD';
 END IF;
 FOREACH k IN ARRAY ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at'] LOOP
   IF jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(allowed) a WHERE a->>'country_code'=p_payload->>'country_code' AND a->>'platform'=p_payload->>'platform')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cred) c WHERE c->>'country_code'=p_payload->>'country_code' AND c->>'platform'=p_payload->>'platform') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ARO_SCOPE_DENIED';
 END IF;
 IF p_payload->>'batch_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p_payload->>'order_kind' NOT IN ('recharge','withdraw')
   OR p_payload->>'observed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_IDENTITY';
 END IF;
 BEGIN
   stamp:=(p_payload->>'observed_at')::timestamptz;
   IF stamp<timestamptz '2020-01-01 00:00:00+00' OR stamp>clock_timestamp()+interval '5 minutes'
      OR to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(p_payload->>'observed_at',19) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_OBSERVED_AT';
   END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_OBSERVED_AT'; END;
 IF jsonb_typeof(p_payload->'orders') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'orders')>500 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDERS';
 END IF;
 n:=jsonb_array_length(p_payload->'orders');
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'orders') LOOP
   IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>12
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) f(key) WHERE f.key<>ALL(ARRAY['order_no','member_id','amount','amount_text','status','applied_at','completed_at','operator','raw_channel','channel_type','remark','manual_remark'])) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDER';
   END IF;
   IF NOT public.ar_order_valid_text(r->'order_no',160,false,true) OR NOT public.ar_order_valid_text(r->'member_id',80,true,true)
     OR NOT public.ar_order_valid_text(r->'amount_text',100) OR NOT public.ar_order_valid_text(r->'status',160)
     OR NOT public.ar_order_valid_local_time(r->'applied_at') OR NOT public.ar_order_valid_local_time(r->'completed_at')
     OR NOT public.ar_order_valid_text(r->'operator',240) OR NOT public.ar_order_valid_text(r->'raw_channel',240)
     OR NOT public.ar_order_valid_text(r->'channel_type',240) OR NOT public.ar_order_valid_text(r->'remark',8000)
     OR NOT public.ar_order_valid_text(r->'manual_remark',8000) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDER';
   END IF;
   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN
     IF jsonb_typeof(r->'amount') IS DISTINCT FROM 'string' OR r->>'amount' !~ '^(0|[1-9][0-9]{0,13})[.][0-9]{2}$' THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT';
     END IF;
     IF (r->>'amount')::numeric>90071992547409.91 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT'; END IF;
   END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'order_no') FROM jsonb_array_elements(p_payload->'orders'))<>n THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUPLICATE';
 END IF;
 bid:=(p_payload->>'batch_id')::uuid; fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-batch:'||bid::text,0));
 SELECT payload_hash INTO prior_hash FROM public.ar_collected_order_receipts WHERE batch_id=bid;
 IF FOUND THEN
   IF prior_hash<>fingerprint THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='ARO_BATCH_CONFLICT'; END IF;
   RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','unchanged');
 END IF;
 -- Stable scope lock avoids overlapping-page upsert deadlocks; different scopes remain independent.
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-scope:'||jsonb_build_array(p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind')::text,0));
 INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);
 INSERT INTO public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,completed_at,operator,raw_channel,channel_type,remark,manual_remark,observed_at,batch_id)
 SELECT 'AR',p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind',value->>'order_no',value->>'member_id',(value->>'amount')::numeric,value->>'amount_text',value->>'status',
   (value->>'applied_at')::timestamp,(value->>'completed_at')::timestamp,value->>'operator',value->>'raw_channel',value->>'channel_type',value->>'remark',value->>'manual_remark',stamp,bid
 FROM jsonb_array_elements(p_payload->'orders') ORDER BY value->>'order_no'
 ON CONFLICT(source_system,country_code,platform,order_kind,order_no) DO UPDATE SET
   member_id=excluded.member_id,amount=excluded.amount,amount_text=excluded.amount_text,status=excluded.status,
   applied_at=excluded.applied_at,completed_at=excluded.completed_at,operator=excluded.operator,raw_channel=case
     when excluded.order_kind='withdraw' and excluded.status='已通过'
       and nullif(btrim(excluded.raw_channel),'') is null
       and public.ar_collected_orders.raw_channel='人工确认'
     then public.ar_collected_orders.raw_channel else excluded.raw_channel end,channel_type=excluded.channel_type,
   remark=excluded.remark,manual_remark=excluded.manual_remark,observed_at=excluded.observed_at,batch_id=excluded.batch_id,updated_at=clock_timestamp()
 WHERE public.ar_collected_orders.observed_at<excluded.observed_at;
 RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','accepted');
END;
$function$;
