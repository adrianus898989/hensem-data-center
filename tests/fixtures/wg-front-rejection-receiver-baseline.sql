-- Captured code-only receiver validators; no order records or credentials.
CREATE OR REPLACE FUNCTION private.wg_business_fields_validate(v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k text; t text; a text[]:=array['schema_version','operator_name','operator_class','note_state','remark_sanitized','rejection_reason','interception_reason','interception_codes','front_note_sanitized','back_note_sanitized','front_note_state','back_note_state'];
begin
  if jsonb_typeof(v) is distinct from 'object' or v-a<>'{}'::jsonb or not(v ?& a)
    or v->'schema_version' is distinct from '1'::jsonb
    or v->>'operator_class' is null or v->>'operator_class' not in ('auto','manual','unknown')
    or v->>'note_state' is null or v->>'note_state' not in ('empty','redacted','template','withheld') then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  foreach k in array array['operator_name','remark_sanitized','rejection_reason','interception_reason','front_note_sanitized','back_note_sanitized'] loop
    t:=v->>k;
    if t is not null and (jsonb_typeof(v->k)<>'string' or length(t)<1 or length(t)>(case when k='operator_name' then 80 else 2000 end)
      or t ~ '[[:cntrl:]]') then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
    if k='operator_name' then
      if t is not null and t ~* '[0-9]{7,}|@|https?://|^(0x[0-9a-f]{20,}|[a-z0-9]{32,})$|^[0-9 .-]+$|\m(password|token|secret|cookie|sessionid)\M' then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
    elsif not private.wg_business_note_allowed(t) then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  end loop;
  if v->>'operator_class' is distinct from (case when v->>'operator_name' is null then 'unknown' when lower(v->>'operator_name')=any(array['system','系统','sistema','hệ thống']) then 'auto' else 'manual' end) then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  if jsonb_typeof(v->'interception_codes') is distinct from 'array' or jsonb_array_length(v->'interception_codes')>16 then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  if exists(select 1 from jsonb_array_elements(v->'interception_codes') i where jsonb_typeof(i)<>'string' or not((i#>>'{}')=any(array['first_member_withdrawals','membership_level','member_tags','withdrawal_account_first','deposit_withdrawal_difference','single_withdrawal_amount','unprocessed_reward_risk','recent_manual_deposits','device_member_count','first_recharge_required','designated_discount','recent_wager_multiplier','designated_games','withdrawal_ip_same_name','exemption_not_met','recent_received_amount','unclassified'])))
    or (select count(*)<>count(distinct value) from jsonb_array_elements_text(v->'interception_codes')) then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  if v->>'note_state'='empty' and (v->>'remark_sanitized' is not null or v->>'rejection_reason' is not null or v->>'interception_reason' is not null or jsonb_array_length(v->'interception_codes')<>0) then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  if v->>'note_state'='withheld' then
    foreach k in array array['remark_sanitized','rejection_reason','interception_reason'] loop
      if v->>k is not null and v->>k not in ('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实','未识别拦截原因，原文已隐藏，待核实') then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
    end loop;
  end if;
  foreach k in array array['front','back'] loop
    t:=v->>(k||'_note_state');
    if t is null or t not in ('empty','template','redacted','withheld')
      or (t='empty' and v->>(k||'_note_sanitized') is not null)
      or (t='withheld' and v->>(k||'_note_sanitized') is not null and v->>(k||'_note_sanitized') not in ('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实','未识别拦截原因，原文已隐藏，待核实')) then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.wg_business_note_allowed(t text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare body text:=t; prefix text; clause text; pattern text; has_prefix boolean:=false; matched boolean;
begin
  if t is null then return true; end if;
  if length(t)>2000 or t='' or t ~ '[[:cntrl:]]' then return false; end if;
  foreach prefix in array array['Reasons for not automatically withdrawing funds:','未自动出款原因:','未自动出款原因：'] loop
    if left(body,length(prefix))=prefix then body:=btrim(substr(body,length(prefix)+1));has_prefix:=true;exit; end if;
  end loop;
  if body='' then return false; end if;
  foreach clause in array regexp_split_to_array(body,'[;；]') loop
    clause:=btrim(clause);
    if clause=any(array['业务备注包含未识别或敏感自由文本，原文已隐藏，待核实','未识别拦截原因，原文已隐藏，待核实']) then continue; end if;
    if lower(rtrim(clause,'.。 '))=any(array['银行卡信息错误','银行信息错误','银行账号错误','银行卡信息不一致','银行账户信息不一致','收款人姓名不一致','打码量不足','流水不足','余额不足','重复申请','订单重复','用户取消','会员取消','风控拒绝','审核不通过','超过提现限额','支付失败','通道维护','银行维护','证件信息不一致','凭证不完整','待人工审核','invalid bank details','incorrect bank details','bank account mismatch','beneficiary name mismatch','insufficient turnover','insufficient balance','duplicate request','duplicate order','cancelled by user','rejected by risk control','withdrawal limit exceeded','payment failed','bank maintenance','channel maintenance','incomplete evidence','pending manual review','bank account verification failed','sai thông tin ngân hàng','thông tin ngân hàng không hợp lệ','tên người nhận không khớp','không đủ số dư','chưa đủ vòng cược','yêu cầu trùng lặp','người dùng hủy','bị từ chối bởi kiểm soát rủi ro','vượt hạn mức rút tiền','thanh toán thất bại','ngân hàng bảo trì','dados bancários inválidos','dados bancários incorretos','nome do beneficiário não corresponde','saldo insuficiente','requisito de apostas não cumprido','solicitação duplicada','cancelado pelo usuário','rejeitado pelo controle de risco','limite de saque excedido','falha no pagamento','banco em manutenção']) then continue; end if;
    matched:=false;
    if has_prefix then
      foreach pattern in array array['^(Members'' first (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? withdrawals must be reviewed)$','^(The membership level is in the list of required membership levels)$','^(The member tag exists in the list of required member tags)$','^(The first withdrawal of cash from the withdrawal account must be reviewed)$','^(Deposit and withdrawal difference in the last (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? days (?:≤|≥|<=|>=|<|>|=) (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? Must be reviewed)$','^(Single withdrawal amount (?:≤|≥|<=|>=|<|>|=) (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? must be reviewed)$','^(Members have unprocessed reward risk control records)$','^(There have been manual deposits in the past (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? days that must be reviewed)$','^(This withdrawal device has only (?:≤|≥|<=|>=|<|>|=) (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? member accounts)$','^(Only members who have completed the first recharge are exempt from review)$','^(Received designated discounts must be reviewed)$','^(The coding times in the last (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? days (?:≤|≥|<=|>=|<|>|=) (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? times must be reviewed)$','^(The bets on the designated games must be reviewed, and the logic of exemption from review will not be followed\.?)$','^(The withdrawal IP is exempted from review only if there is no account with the same name)$','^(Not meeting the exemption conditions)$','^(In the past (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? hours, the cumulative amount received (?:≤|≥|<=|>=|<|>|=) (?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})? must be reviewed)$','^(近\s*(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?\s*天充提差额\s*(?:≤|≥|<=|>=|<|>|=)\s*(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?\s*必须审核)$','^(近\s*(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?\s*天有手动加款必须审核)$','^(会员前\s*(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?\s*次提现必须审核)$'] loop
        if clause ~* pattern then matched:=true;exit; end if;
      end loop;
    end if;
    if not matched then return false; end if;
  end loop;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION private.wg_detail_validate_record(r jsonb, site text, biz text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.wg_detail_validate_record_v2(r-'business_fields',site,biz);
  if r ? 'business_fields' then
    perform private.wg_business_fields_validate(r->'business_fields');
    if (r->'business_fields'->>'rejection_reason') is not null and (biz<>'withdraw' or r->>'status_code'<>'7') then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  end if;
end $function$;
