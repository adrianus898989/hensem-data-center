-- Reviewed 2026-10-10 production function. No real credentials or orders.
CREATE OR REPLACE FUNCTION public.publish_ar_collected_orders(p_token_hash text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 cred jsonb; scope_count integer; allowed constant jsonb := '[{"country_code":"PK","platform":"92PKR"},{"country_code":"PK","platform":"92R"},{"country_code":"PK","platform":"92DADU"},{"country_code":"PK","platform":"92GO"},{"country_code":"PK","platform":"92COCO"},{"country_code":"PK","platform":"92GLORY"},{"country_code":"PK","platform":"92STRIKE"},{"country_code":"PK","platform":"92STAR"},{"country_code":"PK","platform":"92.GAME"},{"country_code":"PK","platform":"YAYWIN"},{"country_code":"BR","platform":"POPBRA"},{"country_code":"BR","platform":"POPPG"},{"country_code":"BR","platform":"POP555"},{"country_code":"BR","platform":"POP678"},{"country_code":"BR","platform":"POP888"},{"country_code":"BR","platform":"POPLUA"},{"country_code":"BR","platform":"POPBEM"},{"country_code":"BR","platform":"POPCEU"},{"country_code":"VN","platform":"92LOTTERY"},{"country_code":"VN","platform":"VN168"},{"country_code":"VN","platform":"66CLUB"},{"country_code":"VN","platform":"82VN"},{"country_code":"ID","platform":"55FIVE"},{"country_code":"MY","platform":"MZPLAY"},{"country_code":"MM","platform":"6LOTTERY"},{"country_code":"NG","platform":"FB999"},{"country_code":"IN","platform":"91CLUB"},{"country_code":"IN","platform":"55CLUB"},{"country_code":"IN","platform":"IN999"},{"country_code":"IN","platform":"OKWIN"},{"country_code":"IN","platform":"JALWA"},{"country_code":"IN","platform":"BIGMUMBAI"},{"country_code":"IN","platform":"82LOTTERY"},{"country_code":"IN","platform":"LOTTERY7"},{"country_code":"IN","platform":"51GAME"},{"country_code":"IN","platform":"6CLUB"},{"country_code":"IN","platform":"TPPLAY"},{"country_code":"IN","platform":"RAJA"},{"country_code":"IN","platform":"JAICLUB"},{"country_code":"IN","platform":"Shree.Win"},{"country_code":"IN","platform":"Veer.Game"}]'::jsonb;
 r jsonb; k text; bid uuid; stamp timestamptz; fingerprint text; prior_hash text; n integer;
 dual boolean := false; local_count integer := 0; usdt_count integer := 0; money_ack jsonb := '{}'::jsonb;
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
 dual := p_payload ? 'money_format_version';
 IF dual AND (p_payload->'money_format_version' IS DISTINCT FROM '1'::jsonb
   OR p_payload->>'country_code' IS DISTINCT FROM 'IN' OR p_payload->>'order_kind' IS DISTINCT FROM 'withdraw') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_MONEY_VERSION';
 END IF;
 IF p_payload->>'action' IS DISTINCT FROM 'ingest' OR p_payload->>'source_system' IS DISTINCT FROM 'AR'
   OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>(CASE WHEN dual THEN 9 ELSE 8 END)
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) f(key) WHERE f.key<>ALL(ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at','orders'] || CASE WHEN dual THEN ARRAY['money_format_version'] ELSE ARRAY[]::text[] END)) THEN
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
   IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>(CASE WHEN dual THEN 15 ELSE 12 END)
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) f(key) WHERE f.key<>ALL(ARRAY['order_no','member_id','amount','amount_text','status','applied_at','completed_at','operator','raw_channel','channel_type','remark','manual_remark'] || CASE WHEN dual THEN ARRAY['amount_local','amount_usdt','currency_local'] ELSE ARRAY[]::text[] END)) THEN
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
   IF dual THEN
     IF r->>'currency_local' IS DISTINCT FROM 'INR'
       OR (r->'amount_local'='null'::jsonb AND r->'amount_usdt'='null'::jsonb) THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
     END IF;
     FOREACH k IN ARRAY ARRAY['amount_local','amount_usdt'] LOOP
       IF r->k IS DISTINCT FROM 'null'::jsonb THEN
         IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR r->>k !~ '^(0|[1-9][0-9]{0,13})[.][0-9]{2}$' THEN
           RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
         END IF;
         IF (r->>k)::numeric>90071992547409.91 THEN
           RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
         END IF;
       END IF;
     END LOOP;
     IF upper(btrim(r->>'channel_type'))='USDT' AND r->'amount_usdt'='null'::jsonb THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
     END IF;
     IF upper(btrim(r->>'channel_type')) IN ('BANK CARD','ARPAY','UPI') AND r->'amount_local'='null'::jsonb THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
     END IF;
     IF r->'amount_local' IS DISTINCT FROM 'null'::jsonb THEN local_count := local_count+1; END IF;
     IF r->'amount_usdt' IS DISTINCT FROM 'null'::jsonb THEN usdt_count := usdt_count+1; END IF;
   END IF;
 END LOOP;
 IF dual THEN
   money_ack := jsonb_build_object('money_format_version',1,'money_local_count',local_count,
     'money_usdt_count',usdt_count,'money_missing_local_count',n-local_count);
 END IF;
 IF (SELECT count(DISTINCT value->>'order_no') FROM jsonb_array_elements(p_payload->'orders'))<>n THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUPLICATE';
 END IF;
 bid:=(p_payload->>'batch_id')::uuid; fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-batch:'||bid::text,0));
 SELECT payload_hash INTO prior_hash FROM public.ar_collected_order_receipts WHERE batch_id=bid;
 IF FOUND THEN
   IF prior_hash<>fingerprint THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='ARO_BATCH_CONFLICT'; END IF;
   RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','unchanged') || money_ack;
 END IF;
 -- Stable scope lock avoids overlapping-page upsert deadlocks; different scopes remain independent.
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-scope:'||jsonb_build_array(p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind')::text,0));
 PERFORM private.collector_record_receipt_route_v1('ar_business_direct',p_token_hash,jsonb_build_object('country_code',p_payload->>'country_code','platform',p_payload->>'platform'),'ar_order',bid);
 INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);
 -- Dual fields are evidence, not a currency conversion. Keep legacy payload bytes for the receipt hash.
 INSERT INTO public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,completed_at,operator,raw_channel,channel_type,remark,manual_remark,observed_at,batch_id,
   amount_local,amount_usdt,currency_local,money_format_version,money_observed_at,money_issue_code)
 SELECT 'AR',p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind',value->>'order_no',value->>'member_id',
   (CASE WHEN dual THEN value->>'amount_local' ELSE value->>'amount' END)::numeric,
   CASE WHEN dual THEN value->>'amount_local' ELSE value->>'amount_text' END,value->>'status',
   (value->>'applied_at')::timestamp,(value->>'completed_at')::timestamp,value->>'operator',value->>'raw_channel',value->>'channel_type',value->>'remark',value->>'manual_remark',stamp,bid,
   (value->>'amount_local')::numeric,(value->>'amount_usdt')::numeric,value->>'currency_local',
   CASE WHEN dual THEN 1::smallint END,CASE WHEN dual THEN stamp END,
   CASE WHEN dual AND value->'amount_local'='null'::jsonb THEN 'LOCAL_AMOUNT_NOT_PROVIDED' END
 FROM jsonb_array_elements(p_payload->'orders') ORDER BY value->>'order_no'
 ON CONFLICT(source_system,country_code,platform,order_kind,order_no) DO UPDATE SET
   amount=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_local,public.ar_collected_orders.amount_local) WHEN public.ar_collected_orders.money_format_version=1 THEN public.ar_collected_orders.amount ELSE excluded.amount END,
   amount_text=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_local,public.ar_collected_orders.amount_local)::text WHEN public.ar_collected_orders.money_format_version=1 THEN public.ar_collected_orders.amount_text ELSE excluded.amount_text END,
   amount_local=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_local,public.ar_collected_orders.amount_local) ELSE public.ar_collected_orders.amount_local END,
   amount_usdt=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_usdt,public.ar_collected_orders.amount_usdt) ELSE public.ar_collected_orders.amount_usdt END,
   currency_local=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN excluded.currency_local ELSE public.ar_collected_orders.currency_local END,
   money_format_version=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN excluded.money_format_version ELSE public.ar_collected_orders.money_format_version END,
   money_observed_at=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN excluded.money_observed_at ELSE public.ar_collected_orders.money_observed_at END,
   money_issue_code=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN
     CASE WHEN excluded.amount_local IS NOT NULL THEN NULL
       WHEN public.ar_collected_orders.money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT'
         OR (public.ar_collected_orders.amount_local IS NOT NULL AND excluded.amount_usdt IS NOT NULL
             AND public.ar_collected_orders.amount_usdt IS DISTINCT FROM excluded.amount_usdt)
       THEN 'LOCAL_AMOUNT_STALE_FOR_USDT'
       ELSE 'LOCAL_AMOUNT_NOT_PROVIDED' END
     ELSE public.ar_collected_orders.money_issue_code END,
   member_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.member_id ELSE public.ar_collected_orders.member_id END,
   status=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.status ELSE public.ar_collected_orders.status END,
   applied_at=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.applied_at ELSE public.ar_collected_orders.applied_at END,
   completed_at=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.completed_at ELSE public.ar_collected_orders.completed_at END,
   operator=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.operator ELSE public.ar_collected_orders.operator END,
   channel_type=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.channel_type ELSE public.ar_collected_orders.channel_type END,
   remark=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.remark ELSE public.ar_collected_orders.remark END,
   manual_remark=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.manual_remark ELSE public.ar_collected_orders.manual_remark END,
   observed_at=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.observed_at ELSE public.ar_collected_orders.observed_at END,
   batch_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.batch_id ELSE public.ar_collected_orders.batch_id END,
   raw_channel=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN CASE
     WHEN excluded.order_kind='withdraw' AND excluded.status='已通过'
       AND nullif(btrim(excluded.raw_channel),'') IS NULL AND public.ar_collected_orders.raw_channel='人工确认'
     THEN public.ar_collected_orders.raw_channel ELSE excluded.raw_channel END ELSE public.ar_collected_orders.raw_channel END,
   updated_at=clock_timestamp()
 -- A newer legacy status must not prevent an independently newer monetary proof,
 -- nor may an older proof roll back the business status or its observed_at.
 WHERE public.ar_collected_orders.observed_at<excluded.observed_at OR (excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at));
 RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','accepted') || money_ack;
END;
$function$;
