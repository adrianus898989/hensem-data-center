-- Reconcile encoded collector tooltips with rejection summary and order detail.
-- Only text normalization/classification changes; no source rows or permissions change.
begin;
-- Decode collector tooltip entities as text, never as executable markup.
-- Raw order remarks are unchanged; the API still returns rawRejectionReason.
create or replace function private.dashboard_admin_live_decode_note(p_note text)
returns text language plpgsql immutable parallel safe set search_path='' as $fn$
declare v_text text:=p_note;v_previous text;v_entity text;v_value text;v_code integer;v_pass integer;
begin
 if v_text is null then return null;end if;
 for v_pass in 1..3 loop
  v_previous:=v_text;
  for v_entity in select distinct m[1] from regexp_matches(v_text,'&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp|lpar|rpar|lbrack|rbrack);','gi') m loop
   v_code:=null;v_value:=case lower(v_entity) when 'amp' then '&' when 'lt' then '<' when 'gt' then '>' when 'quot' then '"' when 'apos' then chr(39) when 'nbsp' then ' ' when 'lpar' then '(' when 'rpar' then ')' when 'lbrack' then '[' when 'rbrack' then ']' end;
   if left(lower(v_entity),2)='#x' then v_code:=('x'||lpad(substr(v_entity,3),8,'0'))::bit(32)::integer;
   elsif left(v_entity,1)='#' then v_code:=substr(v_entity,2)::integer;end if;
   if v_code between 1 and 1114111 and v_code not between 55296 and 57343 then v_value:=chr(v_code);end if;
   if v_value is not null then v_text:=replace(v_text,'&'||v_entity||';',v_value);end if;
  end loop;
  exit when v_text=v_previous;
 end loop;
 return v_text;
end;
$fn$;
revoke all on function private.dashboard_admin_live_decode_note(text) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_clean_note(p_note text)
returns text language sql immutable parallel safe set search_path='' as $$
 with decoded as (select regexp_replace(private.dashboard_admin_live_decode_note(p_note),'<br[[:space:]]*/?>',E'\n','gi') note),
 parts as materialized (
  select btrim(regexp_replace(line,'^[[:space:]]+|[[:space:]]+$','','g')) as line,ordinality as position
  from decoded cross join lateral regexp_split_to_table(coalesce(note,''),E'\\r?\\n') with ordinality as p(line,ordinality)
 ), compared as materialized (
  select *,regexp_replace(line,'[\[\]()【】（）]','','g') as comparable from parts
 ), kept as (
  select p.* from compared p where p.line<>'' and not exists (
   select 1 from compared later where later.position>p.position and (
    later.line=p.line or (p.line ~ '([.]{3}|…+)$'
     and length(regexp_replace(p.comparable,'([.]{3}|…+)$',''))>0
     and starts_with(later.comparable,regexp_replace(p.comparable,'([.]{3}|…+)$','')))))
 ) select nullif(string_agg(line,E'\n' order by position),'') from kept
$$;
revoke all on function private.dashboard_admin_live_clean_note(text) from public,anon,authenticated;
-- Only complete, observed diagnostic templates lose their actual values.
-- Configured thresholds, comparators, rule families and unknown/multiple rules survive.
create or replace function private.dashboard_admin_live_blocking_details(p_note text)
returns jsonb language plpgsql immutable parallel safe set search_path='' as $fn$
declare
 note text:=nullif(btrim(regexp_replace(coalesce(private.dashboard_admin_live_clean_note(p_note),''),'[[:space:]]+',' ','g')),'');
 compact text;parts text[];label text;actual text;field text;threshold text;
 amount text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 source_date text:='(?:[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}(?:[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:AM|PM)?)?|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T?[0-9]{2}:[0-9]{2}:[0-9]{2})?)';
begin
 compact:=regexp_replace(translate(note,'：，',':,'),'[[:space:]]+','','g');
 -- A separator and matching actual-value field are mandatory; arbitrary numbers
 -- in bank errors, user IDs, balances or an additional condition are never stripped.
 parts:=regexp_match(compact,'^(首存金额|用户余额)(大于|小于|大于等于|小于等于|不大于|不小于)'||amount||',(首存金额|用户余额):'||amount||'[。;；!！?？]?$');
 if parts is not null and parts[1]=parts[4] then
  threshold:=trim_scale(parts[3]::numeric)::text;label:=parts[1]||parts[2]||threshold;actual:=parts[5];field:=parts[1];
 else
  parts:=regexp_match(compact,'^当日盈利金额(大于|小于|大于等于|小于等于|不大于|不小于)('||substr(amount,2,length(amount)-2)||'|\{金额\}),当日盈利:'||amount||'[。;；!！?？]?$');
  if parts is not null then
   threshold:=case when parts[2]='{金额}' then parts[2] else trim_scale(parts[2]::numeric)::text end;
   label:='当日盈利金额'||parts[1]||threshold;actual:=parts[3];field:='当日盈利';
  else
   parts:=regexp_match(compact,'^累计提款次数不能小于([0-9]{1,18})次,当前累计提现次数:([0-9]{1,18})次[。;；!！?？]?$');
   if parts is not null then threshold:=(parts[1]::numeric)::text;label:='累计提款次数不能小于'||threshold||'次';actual:=parts[2];field:='当前累计提现次数';
   else
    parts:=regexp_match(compact,'^最后充值日限额超过当前配置的最后充值日限制:([0-9]{1,18})天[,;；]+最后充值时间:'||source_date||'[,;；]当前时间:'||source_date||'[,;；]间隔:([0-9]{1,18})天[.。,;；!！?？]*$');
    if parts is not null then threshold:=(parts[1]::numeric)::text;label:='最后充值日限额超过（限制'||threshold||'天）';actual:=parts[2];field:='间隔天数';
    else
     parts:=regexp_match(compact,'^会员在限制的游戏类型中总的投注数:([0-9]{1,18})$');
     if parts is not null then label:='会员在限制的游戏类型中总的投注数';actual:=parts[1];field:='实际投注数';end if;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('reason',coalesce(label,note),'actualValue',actual,'actualField',field,'threshold',threshold);
end;
$fn$;
revoke all on function private.dashboard_admin_live_blocking_details(text) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_blocking_category(p_note text)
returns text language sql immutable parallel safe set search_path='' as $$
 select private.dashboard_admin_live_blocking_details(p_note)->>'reason'
$$;
revoke all on function private.dashboard_admin_live_blocking_category(text) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_rejection_category(p_country_code text,p_note text)
returns text language sql immutable parallel safe set search_path='' as $$
 with cleaned as (select private.dashboard_admin_live_clean_note(p_note) as note), heading as (
  select note,lower(btrim(regexp_replace(coalesce(
    substring(translate(coalesce(note,''),'【】（）()','[][][]') from '^[[:space:]]*\[([^]]{1,100})\]'),
    substring(translate(coalesce(note,''),'】）)',']]]') from '^[[:space:]]*([A-Za-z][A-Za-z /-]{1,99})\]')),
   '[[:space:]]+',' ','g'))) tag from cleaned
 ) select case
  when lower(btrim(coalesce(note,''))) in ('','--','---','----','无','空','n/a','na','详情') then '源备注为空'
  else coalesce(private.dashboard_admin_live_rejection_template(p_country_code,note),case tag
   when 'gift code' then '红包 / 兑换码（Gift Codes）' when 'gift codes' then '红包 / 兑换码（Gift Codes）'
   when 'return rewards' then '回归奖励（Return Rewards）'
   when 'sign-up bonus' then '注册奖励（Sign-up Bonus）'
   when 'vip member monthly rewards' then 'VIP 月度奖励（VIP Member Monthly Rewards）'
   when 'illegal bet' then '违规投注（Illegal Bet）'
   when 'abnormal bet' then '异常投注（Abnormal Bet）'
   when 'arbitrage activity' then '套利行为（Arbitrage Activity）'
   when 'resubmit order' then '重新提交（Resubmit Order）'
   when 'ifsc code incorrect' then 'IFSC 错误（IFSC Code Incorrect）'
   when 'bank incorrect' then '银行资料错误（Bank Incorrect）'
   when 'upi data invalid' then 'UPI 资料错误（UPI Data Invalid）'
   when 'e-wallet data incorrect' then '钱包资料错误（E-Wallet Data Incorrect）'
   when 'e-wallet limit' then '钱包额度限制（E-Wallet Limit）'
   when 'maintenance bank' then '银行维护（Maintenance Bank）'
   when 'maintenance e-wallet' then '钱包维护（Maintenance E-Wallet）'
   when 'arb maintenance' then 'ARB 维护（ARB Maintenance）'
   when 'fail become agent' then '代理条件未满足（Fail become Agent）'
   when 'first withdraw' then '首次提现方式（First Withdraw）'
   when 'withdraw incorrect method' then '提现方式错误（Withdrawal Method Incorrect）'
   when 'withdrawal method incorrect' then '提现方式错误（Withdrawal Method Incorrect）'
   when 'verify usdt' then 'USDT 待验证（Verify USDT）'
   when 'withdrawal cancelled successfully' then '取消提现（Withdrawal Cancelled Successfully）'
   when 'withdrawal failed' then '提现失败 / 联系上级（Withdrawal Failed）'
   end,case when tag is not null then '其他标签 · '||tag else '其他未归类备注' end)
  end from heading
$$;
revoke all on function private.dashboard_admin_live_rejection_category(text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
