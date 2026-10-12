begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
declare p record;e jsonb;
begin
 if to_regprocedure('private.lg_business_note_safe(text)') is not null or to_regprocedure('private.lg_validate_business_raw(jsonb)') is not null then raise exception 'LG_BUSINESS_HELPER_ALREADY_EXISTS';end if;
 for e in select value from jsonb_array_elements($baseline$[{"schema_name": "public", "function_name": "lg_sync_ingest", "signature": "lg_sync_ingest(text,jsonb)", "owner": "postgres", "prosecdef": false, "provolatile": "v", "proparallel": "u", "proconfig": ["search_path=\"\""], "proacl": "{postgres=X/postgres,service_role=X/postgres}", "procost": 100, "definition_md5": "d6baf7ec1615ed56e8f96dfa06bfb380", "prosrc_md5": "9034a0065199b41ed982523aa9bf2ff1"}, {"schema_name": "public", "function_name": "lg_callback_ingest", "signature": "lg_callback_ingest(text,jsonb)", "owner": "postgres", "prosecdef": false, "provolatile": "v", "proparallel": "u", "proconfig": ["search_path=\"\""], "proacl": "{postgres=X/postgres,service_role=X/postgres}", "procost": 100, "definition_md5": "d60ed31d7bc85fed814dc5805af4747a", "prosrc_md5": "033a827ce8b4be235ef2ef76690ba014"}, {"schema_name": "private", "function_name": "lg_window_validate_order", "signature": "private.lg_window_validate_order(jsonb,text,text,text,timestamp with time zone,timestamp with time zone)", "owner": "postgres", "prosecdef": false, "provolatile": "s", "proparallel": "u", "proconfig": ["search_path=\"\""], "proacl": "{postgres=X/postgres,service_role=X/postgres}", "procost": 100, "definition_md5": "57ee9a7c1749f8bc0ca5da306c5bf4e4", "prosrc_md5": "822dad6ebc99ccc3f5608442e10fb81e"}, {"signature": "lg_window_ingest(text,jsonb)", "owner": "postgres", "prosecdef": false, "provolatile": "v", "proparallel": "u", "proconfig": ["search_path=\"\"", "TimeZone=UTC", "statement_timeout=30s"], "proacl": "{postgres=X/postgres,service_role=X/postgres}", "procost": 100, "definition_md5": "f83c418b9ca7994965d2f4dd4971674d", "prosrc_md5": "5a4a91b12594124c27eb4b016e2c9a4d", "schema_name": "public", "function_name": "lg_window_ingest"}]$baseline$::jsonb) loop
  select * into strict p from pg_proc where oid=(case when e->>'schema_name'='public' then 'public.' else '' end||(e->>'signature'))::regprocedure;
  if pg_get_userbyid(p.proowner) is distinct from e->>'owner' or p.prosecdef is distinct from (e->>'prosecdef')::boolean
   or p.provolatile::text is distinct from e->>'provolatile' or p.proparallel::text is distinct from e->>'proparallel'
   or p.proconfig is distinct from array(select jsonb_array_elements_text(e->'proconfig'))
   or p.proacl::text is distinct from e->>'proacl' or p.procost is distinct from (e->>'procost')::real
   or md5(p.prosrc) is distinct from e->>'prosrc_md5' or md5(pg_get_functiondef(p.oid)) is distinct from e->>'definition_md5'
   then raise exception 'LG_BUSINESS_RECEIVER_BASELINE_DRIFT: %',e->>'function_name';end if;
 end loop;
end;$guard$;

-- Fixed business projection only. Never change an incoming order or its hash.
-- This canonicalizer is also available to authorized private readers.
create function private.lg_business_note_safe(v text)
returns text language plpgsql immutable security invoker set search_path='' as $fn$
declare t text; label_pattern text; p text; m text[]; protected text[]:=array[]::text[]; marker text;i integer:=0;
begin
 if v is null then return null;end if;
 t:=normalize(v,NFKC);
 -- Client joins non-printing characters before detecting disguised identifiers.
 t:=regexp_replace(t,U&'[\0001-\0008\000B-\001F\007F-\009F\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]','','g');
 label_pattern:=$re$(?i)(?<![A-Za-z])(?:phone(?:\s*(?:no|number))?|mobile|tel(?:ephone)?|email|e-mail|(?:bank\s*)?(?:card|account)(?:\s*(?:no|number|name))?|full\s*name|real\s*name|user\s*name|name|recipient|beneficiary|address|passport|identity|id\s*(?:card|number|no)|document\s*(?:no|number)|cpf|cnpj|ssn|pix(?:\s*key)?|iban|swift|ifsc|routing|password|token|authorization|cookie|ip(?:\s*address)?|姓名|用户名|收款人|手机号|手机号码|联系电话|电话|邮箱|身份证(?:号)?|证件(?:号码|号)?|银行卡(?:号)?|卡号|银行账户|账户|账号|地址|密码)\s*[:：=]\s*[^\n;；,，]+$re$;
 t:=regexp_replace(t,label_pattern,'[已隐藏]','g');
 foreach p in array array[
  $re$(?i)((?<![A-Za-z])(?:full[ \t]+name|real[ \t]+name|user[ \t]+name|name|recipient|beneficiary)[ \t]+([^\n;；,，:：=]+))$re$,
  $re$((?:姓名|收款人|用户名)[ \t]+([^\n;；,，:：=]+))$re$
 ] loop
  for m in select regexp_matches(t,p,'g') loop
   if btrim(m[2])!~$re$(?i)^(?:mismatch|error|invalid|missing|required|verification|does|not|is|must|check)\M$re$
    and btrim(m[2])!~$re$^(?:不符|错误|缺失|不一致|无效|未填写|未提供|需核对|需要核对|校验失败)$re$
    then t:=replace(t,m[1],'[已隐藏]');end if;
  end loop;
 end loop;
 foreach p in array array[
  $re$(?i)(?:(?:https?|ftp)://|www\.)[^\s<>\[\]，；]+$re$,
  $re$(?i)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*$re$,
  $re$(?i)(?<![A-Z0-9])[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}(?:/[^\s<>\[\]，；]*)?$re$,
  $re$(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])$re$,
  $re$(?i)(?<![A-Z0-9])(?:[A-F0-9]{0,4}:){3,7}[A-F0-9]{0,4}(?![A-Z0-9])$re$,
  $re$(?i)(?<![A-Z0-9])(?:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*)?::(?:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*)?(?![A-Z0-9])$re$,
  $re$(?i)(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}(?![A-Z0-9])$re$,
  $re$(?i)(?<![A-Z0-9])[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}(?![A-Z0-9])$re$,
  $re$(?i)(?<![A-Z0-9])[A-Z]{1,3}\d{5,12}(?![A-Z0-9])$re$,
  $re$(?i)(?<![A-Z0-9])(?:\+?\d[\d ()+./-]{0,16})?[*x•●·][*x•●· \t.-]{1,}[\d ()+./-]*\d(?![A-Z0-9])$re$,
  $re$(?i)\m(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$re$
 ] loop t:=regexp_replace(t,p,'[已隐藏]','g');end loop;
 for m in select regexp_matches(t,$re$(?<!\d)20\d{2}[-/.](?:0[1-9]|1[0-2])[-/.](?:0[1-9]|[12]\d|3[01])(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)$re$,'g') loop
  i:=i+1;protected:=array_append(protected,m[1]);marker:=chr(57600)||chr(57856+i)||chr(57601);
  t:=replace(t,m[1],marker);
 end loop;
 t:=regexp_replace(t,$re$(?<![A-Za-z0-9])\+?\d(?:[\s()./-]*\d){6,}(?:[Xx])?(?![A-Za-z0-9])$re$,'[已隐藏]','g');
 if cardinality(protected)>0 then
  for i in 1..cardinality(protected) loop t:=replace(t,chr(57600)||chr(57856+i)||chr(57601),protected[i]);end loop;
 end if;
 t:=regexp_replace(t,'(?:\[已隐藏\][ \t]*){2,}','[已隐藏]','g');
 t:=regexp_replace(t,'^\s+|\s+$','','g');
 if length(t)>12000 then t:=left(t,12000-length('[内容超长已截断]'))||'[内容超长已截断]';end if;
 return t;
end;$fn$;
revoke all on function private.lg_business_note_safe(text) from public,anon,authenticated;
grant execute on function private.lg_business_note_safe(text) to service_role;

create function private.lg_validate_business_raw(v jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $fn$
declare k text;t text;state text;g jsonb;
 legacy text[]:=array['orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money','status','createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime'];
 money_fields text[]:=array['beforeRechargeWithdrawDiff','currentProfitAmount','rechargeWithdrawDiff'];
 integer_fields text[]:=array['firstFlag','successNo','totalOrderNum','lockType'];
 text_fields text[]:=array['appCode','appName','transactionId','withdrawBankAppName','withdrawChannelName','withdrawMethodName','withdrawThirdName','withdrawTypeCode','withdrawTypeName','rechargeChannelName','rechargeMethodName','rechargeThirdName','rechargeTypeName','thirdMethodName','operatorName','lockOperatorName'];
begin
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;
 if not(v?'businessSchemaVersion') then
  if exists(select 1 from jsonb_object_keys(v) x where not(x=any(legacy)))
   or exists(select 1 from jsonb_each(v) x where jsonb_typeof(x.value) not in('string','number','null')) then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;
  return;
 end if;
 if v->'businessSchemaVersion' is distinct from '1'::jsonb
  or not(v?&array['remark','remarkState','appRemark','appRemarkState'])
  or exists(select 1 from jsonb_object_keys(v) x where not(x=any(legacy||money_fields||integer_fields||text_fields||array['businessSchemaVersion','remark','remarkState','appRemark','appRemarkState','groupList','groupListTruncated'])))
  or exists(select 1 from jsonb_each(v) x where x.key=any(legacy) and jsonb_typeof(x.value) not in('string','number','null')) then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;
 foreach k in array array['remark','appRemark'] loop
  t:=v->>k;state:=v->>(k||'State');
  if jsonb_typeof(v->k) is distinct from 'string' or jsonb_typeof(v->(k||'State')) is distinct from 'string'
   or state not in('present','empty','redacted','missing') or length(t)>12000
   or (state in('empty','missing') and t<>'') or (state='redacted' and t<>'[已隐藏]')
   or (state='present' and (btrim(t)='' or (position('[已隐藏]' in t)>0 and regexp_replace(replace(t,'[已隐藏]',''),'[[:space:][:punct:]_]','','g')='')))
   or t is distinct from private.lg_business_note_safe(t) then raise exception 'LG_INVALID_BUSINESS_NOTE';end if;
 end loop;
 foreach k in array money_fields loop
  if v?k and (jsonb_typeof(v->k) is distinct from 'string' or (v->>k)!~'^-?[0-9]{1,30}(\.[0-9]{1,18})?$') then raise exception 'LG_INVALID_BUSINESS_AMOUNT';end if;
 end loop;
 foreach k in array integer_fields loop
  if v?k and (jsonb_typeof(v->k) is distinct from 'number' or (v->>k)!~'^-?[0-9]+$') then raise exception 'LG_INVALID_BUSINESS_INTEGER';end if;
 end loop;
 foreach k in array text_fields loop
  if v?k then
   t:=v->>k;
   if jsonb_typeof(v->k) is distinct from 'string' or length(t)>(case when k='transactionId' then 200 else 500 end)
    or (not(k='transactionId' and t~'^[A-Za-z0-9_.-]{0,200}$') and t is distinct from private.lg_business_note_safe(t)) then raise exception 'LG_INVALID_BUSINESS_TEXT';end if;
  end if;
 end loop;
 if v?'groupListTruncated' and (v->'groupListTruncated' is distinct from 'true'::jsonb or not(v?'groupList')) then raise exception 'LG_INVALID_BUSINESS_GROUPS';end if;
 if v?'groupList' then
  if jsonb_typeof(v->'groupList') is distinct from 'array' or jsonb_array_length(v->'groupList')>100 then raise exception 'LG_INVALID_BUSINESS_GROUPS';end if;
  for g in select value from jsonb_array_elements(v->'groupList') loop
   if jsonb_typeof(g) is distinct from 'object' or exists(select 1 from jsonb_object_keys(g) x where x not in('groupId','groupName','colorTag')) then raise exception 'LG_INVALID_BUSINESS_GROUPS';end if;
   if g?'groupId' and (jsonb_typeof(g->'groupId') is distinct from 'number' or (g->>'groupId')!~'^-?[0-9]+$') then raise exception 'LG_INVALID_BUSINESS_GROUPS';end if;
   if g?'groupName' and (jsonb_typeof(g->'groupName') is distinct from 'string' or length(g->>'groupName')>500
    or g->>'groupName' is distinct from private.lg_business_note_safe(g->>'groupName')) then raise exception 'LG_INVALID_BUSINESS_GROUPS';end if;
   if g?'colorTag' and (jsonb_typeof(g->'colorTag') is distinct from 'string' or (g->>'colorTag')!~'^(#[A-Fa-f0-9]{3}|#[A-Fa-f0-9]{4}|#[A-Fa-f0-9]{6}|#[A-Fa-f0-9]{8}|[A-Za-z]{1,32})$') then raise exception 'LG_INVALID_BUSINESS_GROUPS';end if;
  end loop;
 end if;
end;$fn$;
revoke all on function private.lg_validate_business_raw(jsonb) from public,anon,authenticated;
grant execute on function private.lg_validate_business_raw(jsonb) to service_role;

do $patch$
declare p record;before_meta jsonb;definition text;body text;old text;new text;
begin
 select * into strict p from pg_proc where oid='public.lg_sync_ingest(text,jsonb)'::regprocedure;before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);body:=p.prosrc;
 old:=$old$   if mode='live' and ((r->'member_id') is distinct from 'null'::jsonb or exists(
    select 1 from jsonb_object_keys(r->'raw') x where x not in (
    'orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money','status',
    'createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime'))) then raise exception 'LG_INVALID_PRIVATE_FIELDS'; end if;$old$;new:=$new$   if mode='live' or ((r->'raw')?'businessSchemaVersion') then
   if jsonb_typeof(r->'member_id') not in ('string','null') or (r->>'member_id' is not null and (r->>'member_id') !~ '^[A-Za-z0-9_-]{1,128}$') then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;
   perform private.lg_validate_business_raw(r->'raw');
   end if;
   if ((r->'raw')?'businessSchemaVersion') and exists(select 1 from jsonb_object_keys(r) x where x not in ('order_no','member_id','status_code','status_text','status_class','order_amount','actual_amount','metric_amount','created_at','finished_at','paid_at','operator_name','operator_kind','handle_seconds','third_party','raw_channel','mapping_code','payment_method','merchant_name','raw')) then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$member_id=excluded.member_id,$old$;new:=$new$member_id=coalesce(excluded.member_id,lg_orders.member_id),$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$is distinct from row(excluded.member_id,$old$;new:=$new$is distinct from row(coalesce(excluded.member_id,lg_orders.member_id),$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 if (length(definition)-length(replace(definition,p.prosrc,'')))/length(p.prosrc)<>1 then raise exception 'LG_BUSINESS_RECEIVER_DEFINITION_DRIFT';end if;
 execute replace(definition,p.prosrc,body);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta then raise exception 'LG_BUSINESS_RECEIVER_METADATA_DRIFT';end if;
end;$patch$;
do $patch$
declare p record;before_meta jsonb;definition text;body text;old text;new text;
begin
 select * into strict p from pg_proc where oid='public.lg_callback_ingest(text,jsonb)'::regprocedure;before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);body:=p.prosrc;
 old:=$old$   if mode='callback' and ((r->'member_id') is distinct from 'null'::jsonb or exists(
    select 1 from jsonb_object_keys(r->'raw') x where x not in (
    'orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money','status',
    'createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime'))) then raise exception 'LG_INVALID_PRIVATE_FIELDS'; end if;$old$;new:=$new$   if jsonb_typeof(r->'member_id') not in ('string','null') or (r->>'member_id' is not null and (r->>'member_id') !~ '^[A-Za-z0-9_-]{1,128}$') then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;
   perform private.lg_validate_business_raw(r->'raw');$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$exists(select 1 from jsonb_each(r->'raw') e where jsonb_typeof(e.value) not in ('string','number','null'))$old$;new:=$new$exists(select 1 from jsonb_each(r->'raw') e where e.key not in ('groupList','groupListTruncated') and jsonb_typeof(e.value) not in ('string','number','null'))$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$member_id=excluded.member_id,$old$;new:=$new$member_id=coalesce(excluded.member_id,lg_orders.member_id),$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$is distinct from row(excluded.member_id,$old$;new:=$new$is distinct from row(coalesce(excluded.member_id,lg_orders.member_id),$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 if (length(definition)-length(replace(definition,p.prosrc,'')))/length(p.prosrc)<>1 then raise exception 'LG_BUSINESS_RECEIVER_DEFINITION_DRIFT';end if;
 execute replace(definition,p.prosrc,body);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta then raise exception 'LG_BUSINESS_RECEIVER_METADATA_DRIFT';end if;
end;$patch$;
do $patch$
declare p record;before_meta jsonb;definition text;body text;old text;new text;
begin
 select * into strict p from pg_proc where oid='private.lg_window_validate_order(jsonb,text,text,text,timestamp with time zone,timestamp with time zone)'::regprocedure;before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);body:=p.prosrc;
 old:=$old$   if ((r->'member_id') is distinct from 'null'::jsonb or exists(
    select 1 from jsonb_object_keys(r->'raw') x where x not in (
    'orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money','status',
    'createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime'))) then raise exception 'LG_INVALID_PRIVATE_FIELDS'; end if;$old$;new:=$new$   if jsonb_typeof(r->'member_id') not in ('string','null') or (r->>'member_id' is not null and (r->>'member_id') !~ '^[A-Za-z0-9_-]{1,128}$') then raise exception 'LG_INVALID_PRIVATE_FIELDS';end if;
   perform private.lg_validate_business_raw(r->'raw');$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$exists(select 1 from jsonb_each(r->'raw') e where jsonb_typeof(e.value) not in ('string','number','null'))$old$;new:=$new$exists(select 1 from jsonb_each(r->'raw') e where e.key not in ('groupList','groupListTruncated') and jsonb_typeof(e.value) not in ('string','number','null'))$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 if (length(definition)-length(replace(definition,p.prosrc,'')))/length(p.prosrc)<>1 then raise exception 'LG_BUSINESS_RECEIVER_DEFINITION_DRIFT';end if;
 execute replace(definition,p.prosrc,body);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta then raise exception 'LG_BUSINESS_RECEIVER_METADATA_DRIFT';end if;
end;$patch$;
do $patch$
declare p record;before_meta jsonb;definition text;body text;old text;new text;
begin
 select * into strict p from pg_proc where oid='public.lg_window_ingest(text,jsonb)'::regprocedure;before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);body:=p.prosrc;
 old:=$old$member_id=lg_orders.member_id, -- privacy-minimized window must not erase an old member association.$old$;new:=$new$member_id=coalesce(excluded.member_id,lg_orders.member_id), -- A legacy null must not erase a known source member.$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$and row(lg_orders.status_code,$old$;new:=$new$and row(lg_orders.member_id,lg_orders.status_code,$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 old:=$old$is distinct from row(excluded.status_code,$old$;new:=$new$is distinct from row(coalesce(excluded.member_id,lg_orders.member_id),excluded.status_code,$new$;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'LG_BUSINESS_RECEIVER_ANCHOR_DRIFT';end if;body:=replace(body,old,new);
 if (length(definition)-length(replace(definition,p.prosrc,'')))/length(p.prosrc)<>1 then raise exception 'LG_BUSINESS_RECEIVER_DEFINITION_DRIFT';end if;
 execute replace(definition,p.prosrc,body);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta then raise exception 'LG_BUSINESS_RECEIVER_METADATA_DRIFT';end if;
end;$patch$;
notify pgrst,'reload schema';
commit;
