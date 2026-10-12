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
