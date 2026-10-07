-- User-authorized shutdown of collected workorder attachments; workorder records remain.
-- Run preflight.sql first and compare production-rpc-before.json. Existing signatures/ACL retained.
-- Only three public AR attachment functions are replaced. No Storage metadata or business data writes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.check_ar_evidence_storage_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
BEGIN
  -- Old V45/V46 workers fail closed before downloading or uploading a file.
  -- Do not spoof retirement: that would erase source_path in their local queues.
  RETURN jsonb_build_object('ok',false,'guard_version',1,
    'disabled',true,'reason','attachments_disabled');
END;
$function$;

CREATE OR REPLACE FUNCTION public.acquire_ar_evidence_upload_v1(p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.ar_evidence_validate_scope_v1(p_scope);
  -- Preserve the existing lease response contract without creating/renewing a lease.
  RETURN jsonb_build_object('ok',true,'allowed',false,'retired',false,
    'lease_token',null,'lease_seconds',600,'disabled',true,'reason','attachments_disabled');
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_ar_workorder_evidence_v1(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r jsonb; k text; v text; key_text text; scope_key text; expected_path text;
  suffix text; expected_kind text; stamp timestamptz;
  n integer; written integer:=0; affected integer;
  seen text[]:=array[]::text[];
  allowed constant text[]:=array['system_name','country_code','platform','work_order_id',
    'source_ref_hash','source_field_key','media_kind','state','object_path','content_sha256',
    'byte_size','mime_type','observed_at','error_code','bucket_id'];
  codes constant text[]:=array['source_unavailable','source_timeout','source_forbidden',
    'invalid_content','unsupported_media','too_large','upload_failed','verification_failed',
    'network_error','bucket_unavailable','bucket_not_private','bucket_limit_invalid',
    'rpc_failed','local_io_error','invalid_source_ref','storage_guard_invalid'];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>1048576 then
    raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_BATCH';
  end if;
  n:=jsonb_array_length(p_rows);
  if n>100 then raise exception using errcode='22023',message='AR_EVIDENCE_BATCH_LIMIT_100';end if;
  -- Validate the entire batch first. Any failure aborts the complete RPC.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or (r-allowed)<>'{}'::jsonb then
      raise exception using errcode='22023',message='AR_EVIDENCE_UNKNOWN_FIELDS';
    end if;
    if not (r ?& array['system_name','country_code','platform','work_order_id','source_ref_hash',
      'source_field_key','media_kind','state','observed_at','bucket_id']) then
      raise exception using errcode='22023',message='AR_EVIDENCE_REQUIRED_FIELDS';
    end if;
    foreach k in array allowed loop
      if k<>'byte_size' and r ? k and r->k<>'null'::jsonb then
        v:=r->>k;
        if jsonb_typeof(r->k)<>'string' or length(v) not between 1 and 300
          or v<>btrim(v) or v ~ '[[:cntrl:]]' then
          raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_TEXT',detail=k;
        end if;
      end if;
    end loop;
    if r->>'system_name' is distinct from 'AR'
      or coalesce(r->>'country_code','') !~ '^[A-Z]{2}$'
      or length(coalesce(r->>'platform','')) not between 1 and 200
      or length(coalesce(r->>'work_order_id','')) not between 1 and 200
      or coalesce(r->>'source_ref_hash','') !~ '^[0-9a-f]{64}$'
      or coalesce(r->>'source_field_key','') !~ '^[0-9]{1,20}$'
      or coalesce(r->>'media_kind','') not in ('image','pdf','video')
      or coalesce(r->>'state','') not in ('pending','ready','retry')
      or r->>'bucket_id' is distinct from 'ar-workorder-evidence' then
      raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_IDENTITY_OR_ENUM';
    end if;
    v:=r->>'observed_at';
    if v is null or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_OBSERVED_AT';
    end if;
    begin stamp:=v::timestamptz;
    exception when others then raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_OBSERVED_AT';end;
    if not isfinite(stamp) then raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_OBSERVED_AT';end if;
    if r->>'state'='ready' then
      if coalesce(r->>'content_sha256','') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(r->'byte_size') is distinct from 'number'
        or r->>'byte_size' !~ '^[0-9]{1,8}$' then
        raise exception using errcode='22023',message='AR_EVIDENCE_READY_METADATA_REQUIRED';
      end if;
      if (r->>'byte_size')::integer not between 1 and 52428800 then
        raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_SIZE';
      end if;
      suffix:=case r->>'mime_type' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
        when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' when 'video/mp4' then 'mp4'
        when 'video/webm' then 'webm' when 'video/quicktime' then 'mov' end;
      expected_kind:=case when suffix in ('jpg','png','webp') then 'image' when suffix='pdf' then 'pdf'
        when suffix in ('mp4','webm','mov') then 'video' end;
      if suffix is null or r->>'media_kind' is distinct from expected_kind or r->>'error_code' is not null then
        raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_READY_MEDIA';
      end if;
      -- sha256 of UTF-8 identity joined by newline; identifiers forbid controls.
      scope_key:=encode(sha256(convert_to(concat_ws(chr(10),r->>'system_name',r->>'country_code',
        r->>'platform',r->>'work_order_id'),'UTF8')),'hex');
      expected_path:='ar/'||(r->>'country_code')||'/'||scope_key||'/'||(r->>'content_sha256')||'.'||suffix;
      if r->>'object_path' is distinct from expected_path then
        raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_OBJECT_PATH';
      end if;
    else
      if r->>'object_path' is not null or r->>'content_sha256' is not null
        or r->>'byte_size' is not null or r->>'mime_type' is not null then
        raise exception using errcode='22023',message='AR_EVIDENCE_NONREADY_OBJECT_FORBIDDEN';
      end if;
      if (r->>'state'='pending' and r->>'error_code' is not null)
        or (r->>'state'='retry' and (r->>'error_code' is null or not(r->>'error_code'=any(codes)))) then
        raise exception using errcode='22023',message='AR_EVIDENCE_INVALID_ERROR_CODE';
      end if;
    end if;
    key_text:=jsonb_build_array(r->>'system_name',r->>'country_code',r->>'platform',
      r->>'work_order_id',r->>'source_ref_hash')::text;
    if key_text=any(seen) then raise exception using errcode='22023',message='AR_EVIDENCE_DUPLICATE_BATCH_KEY';end if;
    seen:=array_append(seen,key_text);
  end loop;

  -- Keep all input validation, but stop all attachment metadata writes.
  -- An in-flight ready publication must fail, never be acknowledged as stored.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS item(value)
             WHERE value->>'state'='ready') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='AR_EVIDENCE_UPLOAD_DISABLED';
  END IF;
  RETURN jsonb_build_object('accepted',n,'written',0,
    'disabled',true,'reason','attachments_disabled');
END;
$function$;

COMMIT;
