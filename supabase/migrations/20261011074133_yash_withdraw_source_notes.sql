-- Preserve source order/risk notes separately. Old rows remain unknown until
-- re-collected; a last operator is not evidence of automatic/manual processing.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $helper_guard$
begin
 if to_regprocedure('private.dashboard_admin_yash_note_text(text,text[])') is not null and not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_yash_note_text(text,text[])') and md5(prosrc)='7b2723a2b53e979d89fcfdf51f647650' and pg_get_userbyid(proowner)='postgres' and not prosecdef and provolatile='i' and proconfig=array['search_path=""']::text[] and proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}') then raise exception 'yash_note_sanitizer_contract_drift';end if;
end $helper_guard$;
create or replace function private.dashboard_admin_yash_note_text(p_text text,p_identifiers text[])
returns text language plpgsql immutable security invoker set search_path='' as $note$
declare v text;ident text;ids text[];markers text[]:=array[]::text[];i integer;marker text;position integer;found integer;
begin
 if p_text is null then return null;end if;
 if length(p_text)>2000 or p_text ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception 'YASH_INVALID_NOTE';end if;
 v:=regexp_replace(p_text,'<[^>]*>',' ','g');
 v:=regexp_replace(v,'(密码|密钥|秘钥|口令|令牌|账号|账户|卡号|账户名|姓名|银行|电话|手机|联系人|谷歌验证|password|secret|token|cookie|authorization|api[_ -]?key|account|phone)[[:space:]]*[:：=]?[[:space:]]*[^,，;；\n]+','[已隐藏]','gi');
 v:=regexp_replace(v,'(passwd|seed|totp|otp[_ -]?secret|助记词)[[:space:]]*[:：=][[:space:]]*[^,，;；\n]+','[已隐藏]','gi');
 v:=regexp_replace(v,'\mbearer[[:space:]]+[^[:space:],，;；]+','[已隐藏]','gi');
 v:=regexp_replace(v,'https?://[^[:space:]]+|www\.[^[:space:]]+','[已移除链接]','gi');
 v:=regexp_replace(v,'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}','[已移除邮箱]','gi');
 v:=regexp_replace(v,'0x[a-f0-9]{40}|(bc1|tb1)[a-z0-9]{20,90}|\mT[1-9A-HJ-NP-Za-km-z]{33}\M','[已移除地址]','gi');
 v:=regexp_replace(v,'[+][0-9][0-9[:space:]().-]{5,}[0-9]','[已移除号码]','g');
 select array_agg(value order by length(value) desc,value) into ids from (select distinct value from unnest(coalesce(p_identifiers,'{}'::text[])) value where length(value) between 7 and 200) q;
 if ids is not null then for i in 1..array_length(ids,1) loop
  ident:=ids[i];marker:='[业务标识'||chr(57600+i-1)||']';while strpos(v,marker)>0 loop marker:=marker||'甲';end loop;markers:=array_append(markers,marker);position:=1;
  loop
   found:=strpos(substr(v,position),ident);exit when found=0;found:=found+position-1;
   if (found=1 or substr(v,found-1,1)!~'[A-Za-z0-9]') and (found+length(ident)>length(v) or substr(v,found+length(ident),1)!~'[A-Za-z0-9]') then
    v:=overlay(v placing marker from found for length(ident));position:=found+length(marker);
   else position:=found+length(ident);end if;
  end loop;
 end loop;end if;
 v:=regexp_replace(v,'@[A-Za-z0-9_]+|[A-Za-z0-9_+/=-]{24,}','[已隐藏]','g');
 v:=regexp_replace(v,'[+]?[0-9][0-9[:space:]().-]{5,}[0-9]','[已移除号码]','g');
 v:=btrim(regexp_replace(v,'[[:space:]]+',' ','g'));
 if ids is not null then for i in 1..array_length(ids,1) loop v:=replace(v,markers[i],ids[i]);end loop;end if;
 return v;
end $note$;
revoke all on function private.dashboard_admin_yash_note_text(text,text[]) from public,anon,authenticated;
grant execute on function private.dashboard_admin_yash_note_text(text,text[]) to service_role;
do $patch$
declare p record;d text;before_acl aclitem[];before_owner oid;pair record;
begin
 select * into p from pg_proc where oid='public.yash_order_ingest(text,jsonb)'::regprocedure;
 if md5(p.prosrc) not in ('d2d5f2f2a445495074b29208fdb5614b','302257476efa96609f79686637ea7548') or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'yash_source_notes_ingest_contract_drift';end if;
 if not exists(select 1 from pg_class where oid='private.yash_orders'::regclass and pg_get_userbyid(relowner)='postgres' and relrowsecurity and not relforcerowsecurity and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('authenticated',oid,'SELECT')) then raise exception 'yash_source_notes_storage_contract_drift';end if;
 if md5(p.prosrc)='302257476efa96609f79686637ea7548' then
  if (select count(*) from pg_attribute where attrelid='private.yash_orders'::regclass and not attisdropped and attname in ('order_note','risk_note') and atttypid='text'::regtype and not attnotnull)<>2 then raise exception 'yash_source_notes_storage_contract_drift';end if;
  if (select count(*) from pg_constraint where conrelid='private.yash_orders'::regclass and contype='c' and ((conname='yash_order_note_length' and replace(pg_get_constraintdef(oid),' NOT VALID','')='CHECK (((order_note IS NULL) OR (length(order_note) <= 2000)))') or (conname='yash_risk_note_length' and replace(pg_get_constraintdef(oid),' NOT VALID','')='CHECK (((risk_note IS NULL) OR (length(risk_note) <= 2000)))')))<>2 then raise exception 'yash_source_notes_storage_contract_drift';end if;
  return;
 end if;
 before_acl:=p.proacl;before_owner:=p.proowner;d:=pg_get_functiondef(p.oid);
 alter table private.yash_orders add column order_note text,add column risk_note text,add constraint yash_order_note_length check(order_note is null or length(order_note)<=2000) not valid,add constraint yash_risk_note_length check(risk_note is null or length(risk_note)<=2000) not valid;
 for pair in select * from (values
 ($old$   v.raw_fields:=clean;$old$,$new$   v.raw_fields:=clean;
   if (r ? 'order_note' or r ? 'risk_note') and v.order_type<>'withdrawal' then raise exception 'YASH_INVALID_NOTE';end if;
   if (r ? 'order_note' and jsonb_typeof(r->'order_note') not in ('string','null')) or (r ? 'risk_note' and jsonb_typeof(r->'risk_note') not in ('string','null')) then raise exception 'YASH_INVALID_NOTE';end if;
   v.order_note:=private.dashboard_admin_yash_note_text(r->>'order_note',array[v.order_no,v.child_order_no,v.supplier_order_no]);
   v.risk_note:=private.dashboard_admin_yash_note_text(r->>'risk_note',array[v.order_no,v.child_order_no,v.supplier_order_no]);$new$),
 ($old$raw_fields,observed_at)
   values$old$,$new$raw_fields,observed_at,order_note,risk_note)
   values$new$),
 ($old$v.currency_basis,v.raw_fields,v.observed_at)
   on conflict$old$,$new$v.currency_basis,v.raw_fields,v.observed_at,v.order_note,v.risk_note)
   on conflict$new$),
 ($old$raw_fields=excluded.raw_fields,observed_at=excluded.observed_at,received_at=t$old$,$new$raw_fields=excluded.raw_fields,observed_at=excluded.observed_at,received_at=t,
    order_note=case when r ? 'order_note' then excluded.order_note else yash_orders.order_note end,
    risk_note=case when r ? 'risk_note' then excluded.risk_note else yash_orders.risk_note end$new$)
 )x(old_text,new_text) loop
  if (length(d)-length(replace(d,pair.old_text,'')))/length(pair.old_text)<>1 then raise exception 'yash_source_notes_ingest_anchor_drift';end if;
  d:=replace(d,pair.old_text,pair.new_text);
 end loop;
 execute d;
 select * into p from pg_proc where oid='public.yash_order_ingest(text,jsonb)'::regprocedure;
 if md5(p.prosrc)<>'302257476efa96609f79686637ea7548' then raise exception 'yash_source_notes_ingest_checksum';end if;
 if p.proacl is distinct from before_acl or p.proowner<>before_owner or p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] then raise exception 'yash_source_notes_ingest_metadata_changed';end if;
end $patch$;
commit;
