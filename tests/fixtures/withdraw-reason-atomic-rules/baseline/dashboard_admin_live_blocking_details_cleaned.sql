CREATE OR REPLACE FUNCTION private.dashboard_admin_live_blocking_details_cleaned(p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
declare
 note text:=p_note;
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
 -- Observed NEWAR rule combinations stay one group per source order.
 -- Match whole clauses only. Numbers/redaction tokens are accepted solely in
 -- observed numeric positions; original sanitized text stays in sourceReason.
 declare
  nr_piece text;nr_match text;nr_parts text[];nr_pieces text[];nr_labels text[]:=array[]::text[];
  nr_rule record;nr_i integer;nr_label text;nr_actual text;nr_field text;nr_threshold text;nr_hit boolean:=false;
  nr_value text:='(?:[0-9]{1,24}(?:[.][0-9]{1,40})?|\[已移除号码\]|\{标识\}[.][0-9]{1,40})';
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
    nr_label:=null;
    -- Keep the existing AR/game path cheap: none of these exact NEWAR families
    -- can match without its source prefix.
    if nr_match ~ '^(累计提款次数[0-9]|总打码倍数(?:[0-9]|\[|\{)|同浏览器指纹人数[0-9]|提款金额(?:[0-9]|\[|\{)|未完成充值,当前充值次数|会员备注不为空,请检查备注|从未充值,本次为第|上次充值后提款|总充值(?:[0-9]|\[|\{)|配置不允许非法定货币自动出款,本单U数量|没有可用提现通道,本单出款金额|首存金额(?:[0-9]|\[|\{)|今日未通过自动出款|同银行账户关联|总提现/总充值|账户余额(?:[0-9]|\[|\{)|总盈利(?:[0-9]|\[|\{)|[0-9]{1,3}日内彩金充值)' then
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
    nr_hit:=nr_hit or nr_label is not null;
    nr_labels:=array_append(nr_labels,nr_label);
   end loop;
   if nr_hit then
    for nr_i in 1..cardinality(nr_pieces) loop
     if nr_labels[nr_i] is null and nr_pieces[nr_i]<>'' then
      -- Every child is a single separator-free atom. Reuse the previous shared
      -- classifier for known AR/game/failure clauses; unknown text is retained.
      -- This path cannot recurse again: a single unrecognized atom falls through.
      nr_labels[nr_i]:=private.dashboard_admin_live_blocking_details_cleaned(nr_pieces[nr_i])->>'reason';
     end if;
    end loop;
    select array_agg(x.v order by x.v collate pg_catalog."C") into nr_labels
     from (select distinct unnest(nr_labels) v) x where x.v is not null and x.v<>'';
    return jsonb_build_object('reason',array_to_string(nr_labels,'；'),
     'actualValue',case when cardinality(nr_pieces)=1 then nr_actual end,
     'actualField',case when cardinality(nr_pieces)=1 then nr_field end,
     'threshold',case when cardinality(nr_pieces)=1 then nr_threshold end);
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
    'actualField',parts[1]||'有效投注','threshold',trim_scale(threshold::numeric)::text);
  end if;
  return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
 end if;
 -- Only complete observed business/failure templates lose dynamic observations.
 -- Each source row still has exactly one canonical reason (compound causes stay together).
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
   if label='代付余额不足' and tax_rest<>'' then tax_labels:=array_append(tax_labels,tax_rest);end if;
  else
   tax_labels:=array_append(tax_labels,tax_piece);
  end if;
 end loop;
 if tax_hit then
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold);
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
  return jsonb_build_object('reason',label,'actualValue',actual,'actualField',field,'threshold',threshold);
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
 return jsonb_build_object('reason',coalesce(label,note),'actualValue',actual,'actualField',field,'threshold',threshold);
end;
$function$

