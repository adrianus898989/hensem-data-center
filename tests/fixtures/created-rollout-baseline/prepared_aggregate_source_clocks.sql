CREATE OR REPLACE FUNCTION private.prepared_aggregate_source_clocks(p_sql text, p_source text, p_basis text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare s text:=p_sql;old text;replacement text;col text;target_col text;columns text[];lower_before integer;upper_before integer;lower_after integer;upper_after integer;
begin
 if p_source='ar' then
  s:=replace(s,'a.raw_channel as raw_provider','a.raw_channel as raw_provider,null::timestamptz as source_updated_at');
  s:=regexp_replace(s,'a[.]completed_at([[:space:]]*>=?[[:space:]]*)[(][$]5 at time zone [$]4[)]','a.completed_at\1($35 at time zone $4)','g');
  s:=regexp_replace(s,'a[.]completed_at([[:space:]]*<[[:space:]]*)[(][$]6 at time zone [$]4[)]','a.completed_at\1($36 at time zone $4)','g');
 elsif p_source='newar' then
  s:=replace(s,'n.provider as raw_provider','n.provider as raw_provider,case when n.dataset=''withdraw'' and n.status_group<>''success'' then null::timestamptz else n.source_updated_at end as source_updated_at');
  col:=case when p_basis='source_updated' then 'n.source_updated_at' else 'n.success_at' end;
  s:=replace(s,'n.success_at is not null',col||' is not null');
  s:=replace(s,'n.success_at>=$5',col||'>=$35');s:=replace(s,'n.success_at<$6',col||'<$36');
 elsif p_source='lg' then
  s:=replace(s,'l.raw_channel as raw_provider','l.raw_channel as raw_provider,null::timestamptz as source_updated_at');
  s:=replace(s,'l.paid_at>=$5','l.paid_at>=$35');s:=replace(s,'l.paid_at<$6','l.paid_at<$36');
 elsif p_source='kb' then
  -- YASH has no order-update clock. Its completion clock stays native.
  s:=replace(s,'as raw_provider','as raw_provider,null::timestamptz as source_updated_at');
  s:=regexp_replace(s,'y[.]completed_at([[:space:]]*>=[[:space:]]*)[$]5','y.completed_at\1$35','g');
  s:=regexp_replace(s,'y[.]completed_at([[:space:]]*<[[:space:]]*)[$]6','y.completed_at\1$36','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*>=[[:space:]]*)[$]5','t.success_at\1$35','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*<[[:space:]]*)[$]6','t.success_at\1$36','g');
 elsif p_source='duoli' then
  s:=replace(s,'private.dashboard_admin_duoli_provider(d.provider_code) as raw_provider','private.dashboard_admin_duoli_provider(d.provider_code) as raw_provider,d.updated_at as source_updated_at');
  s:=regexp_replace(s,'d[.]updated_at([[:space:]]*>=[[:space:]]*)[$]5','d.updated_at\1$35','g');
  s:=regexp_replace(s,'d[.]updated_at([[:space:]]*<[[:space:]]*)[$]6','d.updated_at\1$36','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*>=[[:space:]]*)[$]5','t.success_at\1$35','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*<[[:space:]]*)[$]6','t.success_at\1$36','g');
 elsif p_source='wg' then
  s:=replace(s,'w.provider as raw_provider','w.provider as raw_provider,w.updated_at as source_updated_at');
  col:=case when p_basis='source_updated' then 'w.updated_at' else 'w.success_at' end;
  s:=replace(s,'w.success_at>=$5',col||'>=$35');s:=replace(s,'w.success_at<$6',col||'<$36');
 elsif p_source='game66' then
  s:=replace(s,'c.pay_method_name as raw_provider','c.pay_method_name as raw_provider,null::timestamptz as source_updated_at');
  s:=replace(s,$x$'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)$x$,$x$'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name),w.update_time$x$);
  s:=replace(s,'c.pay_time>=$5','c.pay_time>=$35');s:=replace(s,'c.pay_time<$6','c.pay_time<$36');
  s:=replace(s,'w.update_time>=$5','w.update_time>=$35');s:=replace(s,'w.update_time<$6','w.update_time<$36');
 elsif p_source='panda' then
  -- Legacy source only guarantees created-window membership. Never invent
  -- success/update coverage; unsupported explicit modes are rejected earlier.
  s:=replace(s,'private.dashboard_admin_panda_provider(o.provider_name) raw_provider','private.dashboard_admin_panda_provider(o.provider_name) raw_provider,o.source_updated_at');
 else raise exception using errcode='22023',message='prepared_source_unsupported';end if;
 if s=p_sql or position('source_updated_at' in s)=0 then raise exception using errcode='55000',message='prepared_source_clock_contract_drift';end if;
 -- Each native secondary predicate must be rebound on both sides. Do not
 -- publish after a future source-helper change only partially matches a patch.
 columns:=case p_source when 'ar'then array['a.completed_at']when 'newar'then array['n.success_at']when 'lg'then array['l.paid_at']when 'kb'then array['y.completed_at','t.success_at']when 'duoli'then array['d.updated_at','t.success_at']when 'wg'then array['w.success_at']when 'game66'then array['c.pay_time','w.update_time']else array[]::text[]end;
 foreach col in array columns loop
  target_col:=case when p_basis='source_updated'and p_source='newar'then'n.source_updated_at'when p_basis='source_updated'and p_source='wg'then'w.updated_at'else col end;
  old:=replace(col,'.','[.]');replacement:=replace(target_col,'.','[.]');
  select count(*)into lower_before from regexp_matches(p_sql,old||'[[:space:]]*>=[[:space:]]*[(]?[[:space:]]*[$]5([^0-9]|$)','g');
  select count(*)into upper_before from regexp_matches(p_sql,old||'[[:space:]]*<[[:space:]]*[(]?[[:space:]]*[$]6([^0-9]|$)','g');
  select count(*)into lower_after from regexp_matches(s,replacement||'[[:space:]]*>=[[:space:]]*[(]?[[:space:]]*[$]35([^0-9]|$)','g');
  select count(*)into upper_after from regexp_matches(s,replacement||'[[:space:]]*<[[:space:]]*[(]?[[:space:]]*[$]36([^0-9]|$)','g');
  if lower_before=0 or upper_before=0 or lower_before<>lower_after or upper_before<>upper_after
   or s~(old||'[[:space:]]*(>=|<)[[:space:]]*[(]?[[:space:]]*[$][56]([^0-9]|$)')then raise exception using errcode='55000',message='prepared_source_clock_predicate_drift';end if;
 end loop;

 return s;
end;$function$
