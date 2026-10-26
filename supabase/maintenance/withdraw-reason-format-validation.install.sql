-- Narrow shared reason repair. No raw orders, prepared rows, queues or schedules are modified.
-- Exact metadata/definition CAS; private helpers stay private. Repeated whole-pack application is a no-op.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $repair$
DECLARE specs jsonb:=$specs$[{"signature":"private.dashboard_admin_live_blocking_core(text)","old_hash":"d686cc6046014e8ba1bf45ba7607e922","new_hash":"7497726e16327c8acbb4e33183a327c0","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_blocking_core","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_note"],"proargtypes":["25"],"proisstrict":false,"proparallel":"s","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"owner":"postgres","language":"plpgsql"},{"signature":"private.withdraw_reason_newar_index_valid(jsonb)","old_hash":"0b144e19012114e91bd07ed149ecd9b5","new_hash":"b676aa851cd4552ac193d8d635d97f5b","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_reason_newar_index_valid","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["payload"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"owner":"postgres","language":"plpgsql"}]$specs$::jsonb; s jsonb; p pg_proc; all_before boolean:=true; all_after boolean:=true;
 oid_before jsonb:='{}'::jsonb; finance_before jsonb; reason_before text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION 'reason_format_owner_only';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(specs)LOOP
  SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(s->>'signature');
  IF p.oid IS NULL OR p.proowner<>'postgres'::regrole OR to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prosrc','prolang']IS DISTINCT FROM s->'metadata'
   OR p.prolang IS DISTINCT FROM(SELECT oid FROM pg_language WHERE lanname=s->>'language')THEN RAISE EXCEPTION 'reason_format_metadata_drift: %',s->>'signature';END IF;
  oid_before:=oid_before||jsonb_build_object(s->>'signature',p.oid::text);
  all_before:=all_before AND md5(p.prosrc)=s->>'old_hash';
  all_after:=all_after AND md5(p.prosrc)=s->>'new_hash';
 END LOOP;
 IF all_after THEN RETURN;END IF;
 IF NOT all_before THEN RAISE EXCEPTION 'reason_format_definition_drift';END IF;
 finance_before:=jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),'native',(select jsonb_object_agg(n.id,private.prepared_aggregate_dependency(to_jsonb(n))) from private.prepared_aggregate_native_catalog()n where n.country='印度'and n.source in('ar','newar')));
 reason_before:=private.withdraw_reason_dependency();
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_blocking_core(p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
declare
 note text:=p_note;
 tax_child jsonb;rule_members jsonb:='[]'::jsonb;opaque_residual boolean:=false;
 compact text;parts text[];label text;actual text;field text;threshold text;numeric_part text;fields text[];head text[];suffix text;
 amount text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 diagnostic_amount text:='([+-]?[0-9]+(?:[.][0-9]+)?)';
 numeric_threshold text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 tax_note text;tax_tail text;tax_piece text;tax_rest text;tax_head text;tax_labels text[]:=array[]::text[];tax_rec record;tax_hit boolean:=false;
 source_date text:='(?:[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}(?:[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:AM|PM)?)?|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T?[0-9]{2}:[0-9]{2}:[0-9]{2})?)';
begin
 -- Input has already had exactly one source-note decoding pass.
 note:=nullif(btrim(regexp_replace(coalesce(note,''),'[[:space:]]+',' ','g')),'');
 compact:=regexp_replace(translate(note,'：，',':,'),'[[:space:]]+','','g');

 -- These complete templates carry per-order measurements after a fixed rule.
 -- Keep configured thresholds and distinct outcomes; do not strip arbitrary
 -- numbers, user-written notes, extra conditions or unrecognized source text.
 if length(compact)>4096 then
  return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
 end if;
 -- Preserve the legacy combination and expose only proven atomic members.
 -- Match whole clauses only. Numbers/redaction tokens are accepted solely in
 -- observed numeric positions; original sanitized text stays in sourceReason.
 declare
  nr_child jsonb;nr_piece text;nr_match text;nr_parts text[];nr_pieces text[];nr_labels text[]:=array[]::text[];
  nr_rule record;nr_i integer;nr_label text;nr_actual text;nr_field text;nr_threshold text;nr_hit boolean:=false;
  nr_value text:='(?:[0-9]{1,24}(?:[.][0-9]{1,40})?|\[已移除号码\]|\{标识\}(?:[.][0-9]{1,40})?)';
  nr_count text:='[0-9]{1,18}';
  nr_cmp text:='(小于等于|大于等于|小于|大于)';
 begin
  nr_pieces:=regexp_split_to_array(note,'[;；]');
  if cardinality(nr_pieces)>0 then
   for nr_i in 1..cardinality(nr_pieces) loop
    nr_piece:=btrim(nr_pieces[nr_i]);
    if regexp_replace(nr_piece,'[[:space:]]+','','g') ~
     ('^[0-9]{1,3}[.、][0-9]{1,3}日内彩金充值'||nr_value||nr_cmp||'配置'||nr_value||'[。.!！]?$') then
     nr_piece:=regexp_replace(nr_piece,'^[0-9]{1,3}[.、][[:space:]]*','');
    else
     nr_piece:=regexp_replace(nr_piece,'^[0-9]{1,3}[.、](?![0-9.])[[:space:]]*','');
    end if;
    nr_pieces[nr_i]:=nr_piece;
    nr_match:=regexp_replace(translate(nr_piece,'（）','()'),'[[:space:]]+','','g');
    nr_label:=null;nr_actual:=null;nr_field:=null;nr_threshold:=null;
    -- Keep the existing AR/game path cheap: none of these exact NEWAR families
    -- can match without its source prefix.
    if nr_match ~ '^(累计提款次数[0-9]|总打码倍数(?:[0-9]|\[|\{)|同浏览器指纹人数[0-9]|提款金额(?:[0-9]|\[|\{)|未完成充值,当前充值次数|会员备注不为空,请检查备注|从未充值,本次为第|上次充值后提款|总充值(?:[0-9]|\[|\{)|配置不允许非法定货币自动出款,本单U数量|没有可用提现通道,本单出款金额|USDT-BEP20无可用适配通道|当日盈利(?:[0-9]|\[|\{)|首存金额(?:[0-9]|\[|\{)|今日未通过自动出款|同银行账户关联|总提现/总充值|账户余额(?:[0-9]|\[|\{)|总盈利(?:[0-9]|\[|\{)|[0-9]{1,3}日内彩金充值)' then
    -- Capture 1 = measured value, 2 = direction, 3 = configured threshold.
    -- Empty captures deliberately mean this observed rule has no such value.
    for nr_rule in select * from(values
     ('累计提款次数('||nr_count||')'||nr_cmp||'配置('||nr_count||')次','累计提款次数{op}配置次数','累计提款次数'),
     ('总打码倍数('||nr_value||')\(有效投注'||nr_value||'/总充值'||nr_value||'\)'||nr_cmp||'配置('||nr_value||')(?:倍)?','总打码倍数{op}配置倍数','总打码倍数'),
     ('总打码倍数('||nr_value||')\(总充值为0(?:[.]0+)?\)'||nr_cmp||'配置('||nr_value||')(?:倍)?','总打码倍数（总充值为零）{op}配置倍数','总打码倍数'),
     ('同浏览器指纹人数('||nr_count||')'||nr_cmp||'配置('||nr_count||')(?:人)?','同浏览器指纹人数{op}配置人数','同浏览器指纹人数'),
     ('提款金额('||nr_value||')'||nr_cmp||'自动出款最大金额('||nr_value||')','提款金额{op}自动出款最大金额','提款金额'),
     ('未完成充值,当前充值次数('||nr_count||')()()','未完成充值','当前充值次数'),
     ('会员备注不为空,请检查备注()()()','会员备注不为空，请检查备注',null),
     ('从未充值,本次为第('||nr_count||')次提款,'||nr_cmp||'无充值连续提款配置('||nr_count||')次','从未充值，连续提款次数{op}配置次数','本次提款次数'),
     ('上次充值后提款('||nr_count||')次\(成功'||nr_count||'\+处理中'||nr_count||'\),'||nr_cmp||'无充值连续提款配置('||nr_count||')次','上次充值后连续提款次数{op}配置次数','上次充值后提款次数'),
     ('总充值('||nr_value||')'||nr_cmp||'配置下限('||nr_value||')','总充值{op}配置下限','总充值'),
     ('配置不允许非法定货币自动出款,本单U数量('||nr_value||')()()','配置不允许非法定货币自动出款','本单U数量'),
     ('没有可用提现通道,本单出款金额('||nr_value||')U()()','没有可用提现通道','本单出款金额（U）'),
     -- The observed fiat form omits U; keep currency-specific values in details.
     ('没有可用提现通道,本单出款金额('||nr_value||')()()','没有可用提现通道','本单出款金额'),
     -- BEP20 is an exact source network token, including its numeric suffix.
     ('USDT-BEP20无可用适配通道()()()','USDT-BEP20 无可用适配通道',null),
     -- Daily profit is a separate observed rule from cumulative profit.
     ('当日盈利('||nr_value||')'||nr_cmp||'配置('||nr_value||')','当日盈利{op}配置金额','当日盈利'),
     ('首存金额('||nr_value||')'||nr_cmp||'配置('||nr_value||')','首存金额{op}配置金额','首存金额'),
     ('今日未通过自动出款('||nr_count||')次,'||nr_cmp||'配置('||nr_count||')次','今日未通过自动出款次数{op}配置次数','今日未通过自动出款次数'),
     ('同银行账户关联('||nr_count||')次,'||nr_cmp||'配置('||nr_count||')次','同银行账户关联次数{op}配置次数','同银行账户关联次数'),
     ('总提现/总充值('||nr_value||')\(\(总提现'||nr_value||'\+处理中'||nr_value||'\)/总充值'||nr_value||'\)'||nr_cmp||'配置('||nr_value||')','总提现／总充值比例{op}配置比例','总提现／总充值比例'),
     ('账户余额('||nr_value||')'||nr_cmp||'配置('||nr_value||')','账户余额{op}配置金额','账户余额'),
     ('总盈利('||nr_value||')'||nr_cmp||'配置('||nr_value||')','总盈利{op}配置金额','总盈利')
    )as known(pattern,reason,actual_field) loop
     nr_parts:=regexp_match(nr_match,'^'||nr_rule.pattern||'[。.!！]?$');
     if nr_parts is not null then
      nr_label:=replace(nr_rule.reason,'{op}',coalesce(nr_parts[2],''));
      nr_actual:=case when nr_parts[1] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[1] end;
      nr_threshold:=case when nr_parts[3] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[3] end;
      nr_field:=nr_rule.actual_field;
      exit;
     end if;
    end loop;
    if nr_label is null then
     nr_parts:=regexp_match(nr_match,'^([0-9]{1,3})日内彩金充值('||nr_value||')'||nr_cmp||'配置('||nr_value||')[。.!！]?$');
     if nr_parts is not null then
      -- The observation window is a distinct rule, not a per-order amount.
      nr_label:=nr_parts[1]||'日内彩金充值'||nr_parts[3]||'配置金额';
      nr_actual:=case when nr_parts[2] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[2] end;
      nr_threshold:=case when nr_parts[4] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[4] end;
      nr_field:=nr_parts[1]||'日内彩金充值';
     end if;
    end if;
    end if; -- exact NEWAR prefix guard
    if nr_label is not null then
     rule_members:=rule_members||jsonb_build_array(jsonb_build_object('reason',nr_label,'actualValue',nr_actual,'actualField',nr_field,'threshold',nr_threshold));
    end if;
    nr_hit:=nr_hit or nr_label is not null;
    nr_labels:=array_append(nr_labels,nr_label);
   end loop;
   if nr_hit then
    for nr_i in 1..cardinality(nr_pieces) loop
     if nr_labels[nr_i] is null and nr_pieces[nr_i]<>'' then
      -- Every child is a single separator-free atom. Reuse the previous shared
      -- classifier for known AR/game/failure clauses; unknown text is retained.
      -- This path cannot recurse again: a single unrecognized atom falls through.
      nr_child:=private.dashboard_admin_live_blocking_core(nr_pieces[nr_i]);
      nr_labels[nr_i]:=nr_child->>'reason';
      -- Unmatched residue is opaque: keep the complete original note as one
      -- membership, never manufacture rules by splitting its punctuation.
      if nr_child?'_members' then rule_members:=rule_members||(nr_child->'_members');else opaque_residual:=true;end if;
     end if;
    end loop;
    if opaque_residual then rule_members:=rule_members||jsonb_build_array(jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null));end if;
    select array_agg(x.v order by x.v collate pg_catalog."C") into nr_labels
     from (select distinct unnest(nr_labels) v) x where x.v is not null and x.v<>'';
    return jsonb_build_object('reason',array_to_string(nr_labels,'；'),
     'actualValue',case when cardinality(nr_pieces)=1 then nr_actual end,
     'actualField',case when cardinality(nr_pieces)=1 then nr_field end,
     'threshold',case when cardinality(nr_pieces)=1 then nr_threshold end,'_members',rule_members);
   end if;
  end if;
 end;
 -- These three observed game families differ only in measured amounts.
 -- Group by game; actual amounts and thresholds remain in source/order details.
 -- Require the whole source template, including the strict greater-than sign.
 parts:=regexp_match(compact,'^(棋牌|真人视讯|体育)有效投注:?((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:[.][0-9]+)?)>阈值:?((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:[.][0-9]+)?)[。;；!！?？]?$');
 if parts is not null then
  actual:=replace(parts[2],',','');threshold:=replace(parts[3],',','');
  if length(split_part(actual,'.',1))<=24 and length(split_part(actual,'.',2))<=40
   and length(split_part(threshold,'.',1))<=24 and length(split_part(threshold,'.',2))<=40 then
   return jsonb_build_object('reason',parts[1]||'有效投注超限','actualValue',actual,
    'actualField',parts[1]||'有效投注','threshold',trim_scale(threshold::numeric)::text,'_members',jsonb_build_array(jsonb_build_object('reason',parts[1]||'有效投注超限','actualValue',actual,'actualField',parts[1]||'有效投注','threshold',trim_scale(threshold::numeric)::text)));
  end if;
  return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
 end if;
 -- Only complete observed business/failure templates lose dynamic observations.
 -- Legacy canonical output is unchanged; proven taxonomy clauses also expose members.
 -- Keep unknown clauses intact; source notes are never modified by this classifier.
 -- Necessary-only prefilter: no taxonomy match can be created by removing a
 -- terminal provider/status field or a failure-label prefix. The English guard
 -- uses the original case-insensitive regex semantics, including locale rules.
 if position('充提差额不满足自动提现要求' in note)>0
  or position('用户等级不在自动提现等级范围内' in note)>0
  or position('用户未完成首充会员' in note)>0
  or position('用户不满足第一次提现流水要求' in note)>0
  or position('领取助力' in note)>0
  or position('余额不足' in note)>0
  or note ~* '(available[[:space:]]+channels|amount[[:space:]]+is[[:space:]]+not|insufficient[[:space:]]+balance)' then
 tax_note:=translate(note,'：，；',':,;');
 tax_note:=regexp_replace(tax_note,'[[:space:]]*(?:【代付成功】|\[代付成功\])[[:space:]]*[。.!！;]*$','','g');
 -- This is a terminal provider field, not the preceding risk/failure message.
 tax_note:=regexp_replace(tax_note,'[,;][[:space:]]*渠道(?:名字)?[[:space:]]*:[[:space:]]*[[:alnum:]_.%+()（） /-]{1,120}[[:space:]]*$','','g');
 tax_tail:=tax_note;
 if left(tax_note,1) in ('免','用','充','领') then
 for tax_rec in select * from (values
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?(?:用户)?充提差额不满足自动提现要求(?:[[:space:]]*:[[:space:]]*([+-]?[0-9]+(?:[.][0-9]+)?))?', '充提差额未达免审要求', '充提差额'),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?用户等级不在自动提现等级范围内,([0-9]+),autoWithdrawalLimitLevel:(\[[0-9]+(?:,[0-9]+)*\])', '会员层级不在免审范围', '会员等级'),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?用户未完成首充会员:[0-9]+,null', '会员未完成首充', null),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?用户不满足第一次提现流水要求:isFirstWithdrawal:true,userFlow:[0-9]+(?:[.][0-9]+)?,historicalValidBetting:[0-9]+(?:[.][0-9]+)?', '首次提现流水未达要求', null),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?(?:用户)?(?:领取助力领现金或者代理宝箱活动奖励|领取助力现金或代理宝箱奖励)[(（]多次[)）]', '领取助力现金或代理宝箱奖励（多次）', null)
 ) as known(pattern,reason,actual_field) loop
  parts:=regexp_match(tax_note,'^('||tax_rec.pattern||')(?=$|[,;]|代付异常:)');
  if parts is not null then
   if tax_rec.actual_field is not null and parts[2] is not null and
    (length(split_part(ltrim(parts[2],'+-'),'.',1))>24 or length(split_part(parts[2],'.',2))>40) then
    return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
   end if;
   if tax_rec.actual_field='会员等级' then threshold:=parts[3];tax_labels:=array[tax_rec.reason||'（允许等级：'||threshold||'）'];
   else tax_labels:=array[tax_rec.reason];end if;tax_hit:=true;tax_head:=parts[1];tax_tail:=substr(tax_note,length(tax_head)+1);
   if tax_rec.actual_field is not null then actual:=parts[2];field:=case when actual is not null then tax_rec.actual_field end;end if;
   rule_members:=rule_members||jsonb_build_array(jsonb_build_object('reason',tax_labels[1],'actualValue',actual,'actualField',field,'threshold',threshold));
   exit;
  end if;
 end loop;
 end if; -- necessary-only taxonomy head first-character guard
 -- Unknown clauses keep their values/codes. Only the allowlisted provider metadata
 -- and terminal success status are omitted from an otherwise recognized reason.
 foreach tax_piece in array regexp_split_to_array(coalesce(tax_tail,''),'[,;]') loop
  tax_piece:=btrim(tax_piece);
  if tax_piece='' then continue;end if;
  if cardinality(tax_labels)>0 and tax_piece ~ '^渠道(?:名字)?[[:space:]]*:[[:space:]]*[[:alnum:]_.%+()（） /-]{1,120}$' then continue;end if;
  tax_rest:=regexp_replace(tax_piece,'^(?:(?:失败信息|代付异常)[[:space:]]*:[[:space:]]*)+','','g');
  label:=null;
  if tax_rest ~* '^(?:No[[:space:]]+Available[[:space:]]+Channels|"No[[:space:]]+Available[[:space:]]+Channels")[.]?$' then
   label:='无可用代付通道';
  elsif tax_rest ~* '^The[[:space:]]+amount[[:space:]]+is[[:space:]]+not[[:space:]]+within[[:space:]]+the[[:space:]]+range[[:space:]]+of[[:space:]]+[+-]?[0-9]+(?:[.][0-9]+)?[[:space:]]*-[[:space:]]*[+-]?[0-9]+(?:[.][0-9]+)?[.]?$' then
   label:='提现金额超出通道范围';
  elsif tax_rest ~* '^"?Insufficient[[:space:]]+balance"?(?=$|[^[:alnum:]_])' then
   parts:=regexp_match(tax_rest,'^("?Insufficient[[:space:]]+balance"?)(.*)$','i');
   label:='代付余额不足';tax_rest:=btrim(parts[2]);
  elsif tax_rest in('余额不足','代付余额不足','通道余额不足','商户余额不足') then
   label:='代付余额不足';tax_rest:='';
  end if;
  if label is not null then
   tax_hit:=true;if not label=any(tax_labels) then tax_labels:=array_append(tax_labels,label);end if;
   rule_members:=rule_members||jsonb_build_array(jsonb_build_object('reason',label,'actualValue',null,'actualField',null,'threshold',null));
   if label='代付余额不足' and tax_rest<>'' then opaque_residual:=true;end if;
   if label='代付余额不足' and tax_rest<>'' then tax_labels:=array_append(tax_labels,tax_rest);end if;
  else
   tax_labels:=array_append(tax_labels,tax_piece);
   if tax_piece<>tax_note and left(tax_piece,1)in('免','用','充','领')then
    tax_child:=private.dashboard_admin_live_blocking_core(tax_piece);
    if tax_child?'_members'then rule_members:=rule_members||(tax_child->'_members');else opaque_residual:=true;end if;
   else opaque_residual:=true;end if;
  end if;
 end loop;
 if tax_hit then
  if opaque_residual then rule_members:=rule_members||jsonb_build_array(jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null));end if;
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold,'_members',rule_members);
 end if;
 end if; -- necessary-only taxonomy prefilter
 label:=null;actual:=null;field:=null;
 if starts_with(compact,'充提差负盈利金额') then
  -- A fixed seven-field diagnostic is cheaper and clearer to validate by
  -- delimiters than one long Unicode regex with repeated decimal captures.
  fields:=string_to_array(compact,',');
  if cardinality(fields)=7 then
   head:=regexp_match(fields[1],'^充提差负盈利金额(小于|小于等于|大于|大于等于)([0-9]+(?:[.][0-9]+)?)$');
   suffix:=fields[7];
   if right(suffix,1)=any(array['。',';','；','!','！','?','？']) then suffix:=left(suffix,length(suffix)-1);end if;
   if head is not null and length(split_part(head[2],'.',1))<=18 and length(split_part(head[2],'.',2))<=8
    and starts_with(fields[2],'当前充提差负盈利金额:') and fields[3]='不能自动出款'
    and starts_with(fields[4],'(用户充值总额:') and starts_with(fields[5],'历史提现总额:')
    and starts_with(fields[6],'待处理金额:') and starts_with(suffix,'用户余额:') and right(suffix,1)=')' then
    parts:=array[substr(fields[2],length('当前充提差负盈利金额:')+1),substr(fields[4],length('(用户充值总额:')+1),substr(fields[5],length('历史提现总额:')+1),substr(fields[6],length('待处理金额:')+1),substr(suffix,length('用户余额:')+1,length(suffix)-length('用户余额:')-1)];
    if not exists (select 1 from unnest(parts) value where value !~ '^[+-]?[0-9]+(?:[.][0-9]+)?$'
      or length(split_part(ltrim(value,'+-'),'.',1))>24 or length(split_part(value,'.',2))>40) then
     threshold:=trim_scale(head[2]::numeric)::text;label:='充提差负盈利金额'||head[1]||threshold||'，不能自动出款';
     actual:=parts[1];field:='当前充提差负盈利金额';
    end if;
   end if;
  end if;
 elsif starts_with(compact,'打码倍数小于') then
  parts:=regexp_match(compact,'^打码倍数小于'||numeric_threshold||',不能自动出款,上次提现后的有效投注\(sumLotteryAmount\):'||diagnostic_amount||',上次提现后的成功充值总额:'||diagnostic_amount||',当前用户打码倍数\(userBetTurnoverMultiple\):'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null then
   threshold:=trim_scale(parts[1]::numeric)::text;label:='上次提现后打码倍数小于'||threshold||'，不能自动出款';
   actual:=parts[4];field:='当前用户打码倍数';
  else
   parts:=regexp_match(compact,'^打码倍数小于'||numeric_threshold||',不能自动出款,最后投注统计\(sumLotteryAmount\):'||diagnostic_amount||',最后一笔实际支付金额:('||substr(diagnostic_amount,2,length(diagnostic_amount)-2)||'|\{金额\}),当前用户打码倍数\(userBetTurnoverMultiple\):'||diagnostic_amount||',不能自动出款[。;；!！?？]?$');
   if parts is not null then
    threshold:=trim_scale(parts[1]::numeric)::text;label:='最后一笔充值打码倍数小于'||threshold||'，不能自动出款';
    actual:=parts[4];field:='当前用户打码倍数';
   end if;
  end if;
 elsif compact ~ '^[0-9]{1,3}日内人工充值' then
  parts:=regexp_match(compact,'^([0-9]{1,3})日内人工充值(彩金)?金额(大于|小于|大于等于|小于等于)'||numeric_threshold||',([0-9]{1,3})日内人工充值(彩金)?金额:'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null and parts[1]=parts[5] and coalesce(parts[2],'')=coalesce(parts[6],'') then
   threshold:=trim_scale(parts[4]::numeric)::text;label:=parts[1]||'日内人工充值'||coalesce(parts[2],'')||'金额'||parts[3]||threshold;
   actual:=parts[7];field:=parts[1]||'日内人工充值'||coalesce(parts[2],'')||'金额';
  end if;
 elsif starts_with(compact,'打码倍数校验通过@') then
  parts:=regexp_match(compact,'^打码倍数校验通过@[0-9]{4}-[0-9]{2}-[0-9]{2}[T]?[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?\(倍数'||diagnostic_amount||'(≥|>)'||numeric_threshold||',有效投注'||diagnostic_amount||',充值'||diagnostic_amount||'\)[。;；!！?？]?$');
  if parts is not null then
   threshold:=trim_scale(parts[3]::numeric)::text;label:='打码倍数校验通过（倍数'||parts[2]||threshold||'）';actual:=parts[1];field:='打码倍数';
  end if;
 elsif starts_with(compact,'打码倍数') then
  parts:=regexp_match(compact,'^打码倍数'||diagnostic_amount||'(小于|小于等于)'||numeric_threshold||',充提差负盈利金额'||diagnostic_amount||'(大于|大于等于)'||numeric_threshold||',按充提差负盈利放行[。;；!！?？]?$');
  if parts is not null then
   threshold:='打码'||parts[2]||trim_scale(parts[3]::numeric)::text||'；充提差'||parts[5]||trim_scale(parts[6]::numeric)::text;
   label:='打码倍数'||parts[2]||trim_scale(parts[3]::numeric)::text||'，充提差负盈利金额'||parts[5]||trim_scale(parts[6]::numeric)::text||'，按充提差负盈利放行';
   actual:=parts[1]||' / '||parts[4];field:='打码倍数 / 充提差负盈利金额';
  else
   parts:=regexp_match(compact,'^打码倍数'||diagnostic_amount||'(大于|大于等于)'||numeric_threshold||'\(累计打码量'||diagnostic_amount||'/需要打码量'||diagnostic_amount||'\)[。;；!！?？]?$');
   if parts is not null then
    threshold:=trim_scale(parts[3]::numeric)::text;label:='打码倍数'||parts[2]||threshold||'（累计打码量 / 需要打码量）';actual:=parts[1];field:='打码倍数';
   end if;
  end if;
 elsif starts_with(compact,'存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单') then
  parts:=regexp_match(compact,'^(存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单,无法核对打码倍数,不能自动出款),单号:([0-9]{1,30}(?:,[0-9]{1,30}){0,99})(?:等[0-9]{1,9}笔)?[。;；!！?？]?$');
  if parts is not null then label:=parts[1];actual:=parts[2];field:='相关充值单号';end if;
 elsif starts_with(compact,'打码统计源无法覆盖上次提现后的完整周期') then
  parts:=regexp_match(compact,'^(打码统计源无法覆盖上次提现后的完整周期,无法核对打码倍数,不能自动出款),上次提现后的成功充值总额:'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null then label:=parts[1];actual:=parts[2];field:='上次提现后的成功充值总额';end if;
 end if;
 if label is not null then
  -- Keep numeric bounds outside the matching expression: repeated bounded
  -- decimal ranges multiply the regex automaton for long source diagnostics.
  foreach numeric_part in array parts loop
   if field<>'相关充值单号' and numeric_part ~ '^[+-]?[0-9]+(?:[.][0-9]+)?$' and
    (length(split_part(ltrim(numeric_part,'+-'),'.',1))>24 or length(split_part(numeric_part,'.',2))>40) then
    return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
   end if;
  end loop;
  return jsonb_build_object('reason',label,'actualValue',actual,'actualField',field,'threshold',threshold,'_members',jsonb_build_array(jsonb_build_object('reason',label,'actualValue',actual,'actualField',field,'threshold',threshold)));
 end if;
 -- A separator and matching actual-value field are mandatory; arbitrary numbers
 -- in bank errors, user IDs, balances or an additional condition are never stripped.
 parts:=case when starts_with(compact,'首存金额') or starts_with(compact,'用户余额') then regexp_match(compact,'^(首存金额|用户余额)(大于|小于|大于等于|小于等于|不大于|不小于)'||amount||',(首存金额|用户余额):'||amount||'[。;；!！?？]?$') end;
 if parts is not null and parts[1]=parts[4] then
  threshold:=trim_scale(parts[3]::numeric)::text;label:=parts[1]||parts[2]||threshold;actual:=parts[5];field:=parts[1];
 else
  parts:=case when starts_with(compact,'用户历史总领取的红包大于或者等于配置值不能自动出款') then regexp_match(compact,'^(用户历史总领取的红包大于或者等于配置值不能自动出款),用户历史红包领取总额\(userRedPacketTotalAmount\):'||amount||',当前配置的历史红包领取总额限制是\(ReceiveRedSumAmount\):'||amount||'[。;；!！?？]*$') end;
  if parts is not null then
   label:=parts[1];actual:=parts[2];field:='userRedPacketTotalAmount';threshold:=trim_scale(parts[3]::numeric)::text;
  else
   parts:=case when starts_with(compact,'用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款') then regexp_match(compact,'^(用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款),用户最后一次充值之后领取的红包总额\(userLastRechgRecvReadSumAmount\):'||amount||',当前配置的最后一次充值之后领取的红包总额限制是\(LastRechgRecvReadSumAmount\):'||amount||'[。;；!！?？]*$') end;
   if parts is not null then
    label:=parts[1];actual:=parts[2];field:='userLastRechgRecvReadSumAmount';threshold:=trim_scale(parts[3]::numeric)::text;
   else
  parts:=case when starts_with(compact,'当日盈利金额') then regexp_match(compact,'^当日盈利金额(大于|小于|大于等于|小于等于|不大于|不小于)('||substr(amount,2,length(amount)-2)||'|\{金额\}),当日盈利:'||amount||'[。;；!！?？]?$') end;
  if parts is not null then
   threshold:=case when parts[2]='{金额}' then parts[2] else trim_scale(parts[2]::numeric)::text end;
   label:='当日盈利金额'||parts[1]||threshold;actual:=parts[3];field:='当日盈利';
  else
   parts:=case when starts_with(compact,'累计提款次数不能小于') then regexp_match(compact,'^累计提款次数不能小于([0-9]{1,18})次,当前累计提现次数:([0-9]{1,18})次[。;；!！?？]?$') end;
   if parts is not null then threshold:=(parts[1]::numeric)::text;label:='累计提款次数不能小于'||threshold||'次';actual:=parts[2];field:='当前累计提现次数';
   else
    parts:=case when starts_with(compact,'最后充值日限额超过当前配置的最后充值日限制:') then regexp_match(compact,'^最后充值日限额超过当前配置的最后充值日限制:([0-9]{1,18})天[,;；]+最后充值时间:'||source_date||'[,;；]当前时间:'||source_date||'[,;；]间隔:([0-9]{1,18})天[.。,;；!！?？]*$') end;
    if parts is not null then threshold:=(parts[1]::numeric)::text;label:='最后充值日限额超过（限制'||threshold||'天）';actual:=parts[2];field:='间隔天数';
    else
     parts:=case when starts_with(compact,'会员在限制的游戏类型中总的投注数:') then regexp_match(compact,'^会员在限制的游戏类型中总的投注数:([0-9]{1,18})$') end;
     if parts is not null then label:='会员在限制的游戏类型中总的投注数';actual:=parts[1];field:='实际投注数';end if;
    end if;
   end if;
  end if;
 end if;
  end if;
 end if;
 return jsonb_build_object('reason',coalesce(label,note),'actualValue',actual,'actualField',field,'threshold',threshold)||case when label is not null then jsonb_build_object('_members',jsonb_build_array(jsonb_build_object('reason',label,'actualValue',actual,'actualField',field,'threshold',threshold)))else '{}'::jsonb end;
end;
$function$
$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_index_valid(payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE idx jsonb:=payload->'_newarLabelIndex';bad boolean;
BEGIN
 IF payload->>'reasonGrouping'IS DISTINCT FROM'atomic_rules_v1'
 OR idx->>'format'IS DISTINCT FROM'newar-label-index-v2'OR jsonb_typeof(idx->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(payload->'rows')IS DISTINCT FROM'array'
 OR idx->>'integrity'IS DISTINCT FROM md5(jsonb_build_array('newar-label-index-v2',idx->'rows')::text)
 THEN RETURN false;END IF;
 -- Validate row shape before expanding its members or casting counts.
 -- The staged statements retain the original fail-closed checks while avoiding
 -- one PL/pgSQL query/assignment for every label and every rule membership.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(idx->'rows') r(v_row)
  WHERE CASE WHEN jsonb_typeof(v_row)IS DISTINCT FROM'array' THEN true ELSE
   jsonb_array_length(v_row)<>9
   OR jsonb_typeof(v_row->0)IS DISTINCT FROM'string'OR jsonb_typeof(v_row->1)NOT IN('string','null')
   OR coalesce(v_row->>2,'')NOT IN('present','unknown')OR jsonb_typeof(v_row->3)IS DISTINCT FROM'array'
   OR CASE WHEN jsonb_typeof(v_row->3)='array' THEN jsonb_array_length(v_row->3)=0 ELSE true END
   OR jsonb_typeof(v_row->4)IS DISTINCT FROM'object'
   OR(v_row->4)-ARRAY['actualValue','actualField','threshold']<>'{}'::jsonb
   OR coalesce(v_row->>5,'')!~'^[0-9]+$'OR coalesce(v_row->>6,'')!~'^[0-9]+$'
   OR coalesce(v_row->>7,'')!~'^[0-9]+$'OR coalesce(v_row->>8,'')!~'^[0-9]+$'
   OR jsonb_typeof(v_row->5)<>'number'OR jsonb_typeof(v_row->6)<>'number'OR jsonb_typeof(v_row->7)<>'number'OR jsonb_typeof(v_row->8)<>'number'
   OR(v_row->>2='present')IS DISTINCT FROM coalesce((case when v_row->>2='present'then coalesce(v_row->>1,v_row->>0)else v_row->>1 end) ~ '[^[:space:]]',false)
  END)THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(idx->'rows') r(v_row)
  CROSS JOIN LATERAL jsonb_array_elements(v_row->3) m(v_member)
  WHERE CASE WHEN jsonb_typeof(v_member)IS DISTINCT FROM'object'
   OR jsonb_typeof(v_member->'details')IS DISTINCT FROM'object' THEN true ELSE
   jsonb_typeof(v_member->'reason')IS DISTINCT FROM'string'
   OR nullif(v_member->>'reason','')IS NULL
   OR v_member->>'reasonKey'IS DISTINCT FROM md5(jsonb_build_array('atomic_rules_v1','newar',v_row->>2,v_member->>'reason')::text)
   OR (v_member->'details')-ARRAY['actualValue','actualField','threshold']<>'{}'::jsonb
   OR NOT(v_member->'details'?&ARRAY['actualValue','actualField','threshold'])
   OR EXISTS(SELECT 1 FROM jsonb_each(v_member->'details')d WHERE jsonb_typeof(d.value)NOT IN('string','null'))
  END)THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(idx->'rows')WITH ORDINALITY r(v_row,ord)
  CROSS JOIN LATERAL jsonb_array_elements(v_row->3) m(v_member)
  GROUP BY ord HAVING count(*)<>count(DISTINCT v_member->>'reasonKey'))THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'rows')r(x)WHERE jsonb_typeof(x)IS DISTINCT FROM'object'
  OR coalesce(x->>'reasonKey','')!~'^[a-f0-9]{32}$'OR jsonb_typeof(x->'reason')IS DISTINCT FROM'string'
  OR coalesce(x->>'noteState','')NOT IN('present','unknown')
  OR coalesce(x->>'count','')!~'^[0-9]+$'OR coalesce(x->>'success','')!~'^[0-9]+$'
  OR coalesce(x->>'rejected','')!~'^[0-9]+$'OR coalesce(x->>'other','')!~'^[0-9]+$')THEN RETURN false;END IF;
 WITH i AS MATERIALIZED(SELECT value x FROM jsonb_array_elements(idx->'rows')),
 grouped AS(SELECT m->>'reasonKey'key,m->>'reason'reason,x->>2 state,
  sum((x->>5)::bigint)n,sum((x->>6)::bigint)s,sum((x->>7)::bigint)r,sum((x->>8)::bigint)o
  FROM i CROSS JOIN LATERAL jsonb_array_elements(x->3)e(m)GROUP BY 1,2,3),
 g AS(SELECT value x FROM jsonb_array_elements(payload->'rows'))
 SELECT coalesce((SELECT sum((x->>5)::bigint)FROM i),0)<>coalesce((payload->>'noteCount')::bigint,0)
 OR(SELECT count(*)FROM i)<>(SELECT count(DISTINCT x->>0)FROM i)
 OR(SELECT count(*)FROM g)<>(SELECT count(DISTINCT x->>'reasonKey')FROM g)
 OR EXISTS(SELECT 1 FROM i WHERE(x->>5)::bigint<>(x->>6)::bigint+(x->>7)::bigint+(x->>8)::bigint)
 OR EXISTS(SELECT 1 FROM grouped a FULL JOIN g ON g.x->>'reasonKey'=a.key
   WHERE a.key IS NULL OR g.x IS NULL OR a.reason IS DISTINCT FROM g.x->>'reason'OR a.state IS DISTINCT FROM g.x->>'noteState'
    OR a.n<>(g.x->>'count')::bigint OR a.s<>(g.x->>'success')::bigint
    OR a.r<>(g.x->>'rejected')::bigint OR a.o<>(g.x->>'other')::bigint)
 OR ((payload->'available'='true'::jsonb OR coalesce((SELECT sum(n)FROM grouped),0)>0) AND (
  payload->'summary'->'ruleMembership'->>'unit'IS DISTINCT FROM'distinct_order_per_rule'
  OR payload->'summary'->'ruleMembership'->'overlapping'IS DISTINCT FROM'true'::jsonb
  OR(payload->'summary'->'ruleMembership'->>'hitCount')::bigint IS DISTINCT FROM coalesce((SELECT sum(n)FROM grouped),0))) INTO bad;
 RETURN NOT bad;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$function$

$definition$;
 FOR s IN SELECT value FROM jsonb_array_elements(specs)LOOP
  SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(s->>'signature');
  IF md5(p.prosrc)IS DISTINCT FROM s->>'new_hash' OR p.oid::text IS DISTINCT FROM oid_before->>(s->>'signature')
   OR p.proowner<>'postgres'::regrole OR to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prosrc','prolang']IS DISTINCT FROM s->'metadata'
   OR p.prolang IS DISTINCT FROM(SELECT oid FROM pg_language WHERE lanname=s->>'language')THEN RAISE EXCEPTION 'reason_format_postflight_mismatch';END IF;
 END LOOP;
 IF finance_before IS DISTINCT FROM jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),'native',(select jsonb_object_agg(n.id,private.prepared_aggregate_dependency(to_jsonb(n))) from private.prepared_aggregate_native_catalog()n where n.country='印度'and n.source in('ar','newar'))) THEN RAISE EXCEPTION 'reason_format_financial_dependency_changed';END IF;
 IF reason_before IS NOT DISTINCT FROM private.withdraw_reason_dependency()THEN RAISE EXCEPTION 'reason_format_cache_generation_unchanged';END IF;
END;$repair$;
COMMIT;
