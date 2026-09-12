"use client";
import {useState,type ReactNode} from "react";
import type {WGConfiguration,WGConfigSetting} from "@/lib/wgConfigContract";
import "./WGConfigSheet.css";

type Values=Record<string,unknown>;
type Option={id:number;name:string};
type TreeNode={key:string;name:string;children?:TreeNode[];selected?:boolean|null};
const object=(value:unknown):Values=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Values:{};
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const literal=(value:unknown)=>value===undefined?"接口未提供":JSON.stringify(value);

function ReadValue({value,label,wide=false}:{value:unknown;label:string;wide?:boolean}) {
  if(value===null||value===undefined)return <span className="wgc-unknown">{value===null?"接口返回空值":"接口未提供"}</span>;
  if(typeof value!=="string"&&typeof value!=="number")return <span className="wgc-unknown">原值：{literal(value)}</span>;
  return <input className={"wgc-input"+(wide?" wide":"")} aria-label={label+"（只读）"} readOnly value={String(value)} placeholder="未填写"/>;
}
function Check({checked,children,mixed=false}:{checked:boolean|null;children:ReactNode;mixed?:boolean}) {
  return <label className={"wgc-check"+(checked===true?" selected":"")+(mixed?" mixed":"")}>
    {checked===null?<span className="wgc-unknown-mark" role="img" aria-label="勾选状态未核实">?</span>:<input type="checkbox" checked={checked} disabled aria-checked={mixed?"mixed":checked}/>}
    <span>{children}</span></label>;
}
function Row({label,children,help,id}:{label:string;children:ReactNode;help?:string;id?:string}) {
  return <div className="wgc-row" data-field={id}><div className="wgc-label">{label}{help&&<small>{help}</small>}</div><div className="wgc-value">{children}</div></div>;
}
function Selection({selected,options,label}:{selected:unknown;options:Option[];label:string}) {
  const values=Array.isArray(selected)?selected:null;
  const unknown=values?.filter(id=>!options.some(option=>option.id===id))||[];
  const count=values?options.filter(option=>values.includes(option.id)).length:0;
  const all=Boolean(values&&options.length&&count===options.length&&unknown.length===0);
  return <div role="group" aria-label={label+"（只读）"}>
    <Check checked={values?all:null} mixed={Boolean(values&&count>0&&!all)}>全选</Check>
    <div className="wgc-check-grid">{options.map(option=><Check key={option.id} checked={values?values.includes(option.id):null}>{option.name}</Check>)}</div>
    {unknown.length>0&&<div className="wgc-unmapped"><small>已选项不在本次名称字典中，保留原值：</small>{unknown.map((id,index)=><Check key={index} checked>未映射 ID：{literal(id)}</Check>)}</div>}
    {!values&&<small className="wgc-unknown">源接口值：{literal(selected)}，不推断勾选状态。</small>}
    {options.length===0&&<small className="wgc-unknown">名称字典未提供或为空。</small>}
  </div>;
}
function Switch({value,label,off,on,mappingVerified=true}:{value:unknown;label:string;off:string;on:string;mappingVerified?:boolean}) {
  const known=mappingVerified&&(value===0||value===1);
  return <div className="wgc-radios" role="group" aria-label={label+"（只读）"}>{[{value:0,label:off},{value:1,label:on}].map(option=><label key={option.value} className={known&&value===option.value?"selected":""}>{known?<input type="radio" checked={value===option.value} disabled/>:<span className="wgc-unknown-mark" role="img" aria-label="开关选中状态未核实">?</span>}{option.label}</label>)}{!known&&<small className="wgc-unknown">当前原值：{literal(value)}；开关映射待核实</small>}</div>;
}
function Registration({value,required}:{value:unknown;required:boolean}) {
  // Only 0 has a verified source enum. The screenshot confirms the remaining
  // labels, not their API codes: never guess which one a future value selects.
  const labels=required?["关闭此条件","24小时以内","3天以内","7天以内","30天以内"]:["关闭此条件","超24小时","超3天","超7天","超30天"];
  return <><div className="wgc-radios" role="group" aria-label={(required?"必审":"免审")+"注册时长（只读）"}>{labels.map((label,index)=><label key={label} className={value===0&&index===0?"selected":""}>{value===0?<input type="radio" checked={index===0} disabled/>:<span className="wgc-unknown-mark" role="img" aria-label="选中状态未核实">?</span>}{label}</label>)}</div>{value!==0&&<small className="wgc-unknown">当前接口原值：{literal(value)}；选项原码未核实，不推断选中项。</small>}</>;
}
function SelectionTree({nodes,selected,label}:{nodes:TreeNode[];selected:unknown;label:string}) {
  // Only explicit, fully matched paths can supply a selected leaf. Empty child
  // ID lists have unverified semantics and must not imply a selected branch.
  const knownEmpty=Array.isArray(selected)&&selected.length===0;
  const state=(node:TreeNode)=>node.selected!==undefined?node.selected:knownEmpty?false:null;
  const branch=(node:TreeNode):ReactNode=>node.children?.length?<details className="wgc-tree-branch" key={node.key}>
    <summary><Check checked={state(node)}>{node.name}</Check><span className="wgc-tree-count">{node.children.length}</span></summary>
    <div className="wgc-tree-children">{node.children.map(branch)}</div></details>:<div className="wgc-tree-leaf" key={node.key}><Check checked={state(node)}>{node.name}</Check></div>;
  return <><div className="wgc-tree" aria-label={label+"选项（只读）"}>{nodes.length?nodes.map(branch):<p className="wgc-unknown">该选项名单暂未同步。</p>}</div>
    {!knownEmpty&&<details className="wgc-selection-raw"><summary>{label}当前原值 · 未映射部分保留原结构</summary><pre>{JSON.stringify(selected,null,2)}</pre></details>}</>;
}
const amountRows=(value:unknown)=>array(value).map(object);
function AmountFields({entry,mode,merchants}:{entry:Values;mode:"required"|"exempt"|"payment";merchants:Option[]}) {
  if(mode==="payment") {
    const known=entry.selectType===0;
    return <><div className="wgc-inline"><span>代付模式</span><div className="wgc-radios" role="group" aria-label="代付模式（只读）"><label className={known?"selected":""}>{known?<input type="radio" checked disabled/>:<span className="wgc-unknown-mark">?</span>}自动匹配三方代付</label><label>{known?<input type="radio" checked={false} disabled/>:<span className="wgc-unknown-mark">?</span>}人工指定三方代付</label></div></div>
      {!known&&<small className="wgc-unknown">当前代付模式原码：{literal(entry.selectType)}</small>}
      <details className="wgc-payment-options"><summary>查看三方代付选项与保存值（只读）</summary><Selection selected={entry.merchList} options={merchants} label="指定三方代付"/></details></>;
  }
  const required=mode==="required";
  return <div className="wgc-amount-lines">
    <div className="wgc-inline"><span>近</span><ReadValue value={entry.receivedAmountByTime} label="领取优惠统计时长"/><span>小时，{required?"优惠累计领取 ≥":"累计领取 <"}</span><ReadValue value={entry.receivedAmount} label="累计领取金额" wide/><span>{required?"必须审核":"免审核的情形"}</span></div>
    <div className="wgc-inline"><span>近</span><ReadValue value={entry.reviewAmountByTime} label="免审核金额统计时长"/><span>小时，免审核金额{required?" ≥":" <"}</span><ReadValue value={entry.reviewAmount} label="免审核金额" wide/><span>{required?"必须审核":"免审核的情形"}</span></div>
    <div className="wgc-inline"><span>单笔提现金额 {required?">":"≤"}</span><ReadValue value={entry.minAuditAmount} label="单笔提现金额" wide/><span>{required?"必须审核":"免审核的情形"}</span></div>
    {required&&<div className="wgc-inline"><span>指定银行提现</span><details className="wgc-bank"><summary>查看保存值 · 银行名称待同步</summary><pre>{literal(entry.designateBank)}</pre></details><span>必须审核</span></div>}
  </div>;
}
function LayerRules({entries,levels,merchants,mode}:{entries:unknown;levels:Option[];merchants:Option[];mode:"required"|"exempt"|"payment"}) {
  const records=amountRows(entries);const [selected,setSelected]=useState(0);
  const chosen=records.some(entry=>entry.memberLevelId===selected)?selected:records[0]?.memberLevelId;
  const entry=records.find(item=>item.memberLevelId===chosen);
  const name=(id:unknown)=>id===0?"全部层级":levels.find(level=>level.id===id)?.name||"层级 ID："+String(id);
  return <div className="wgc-layer-box"><div className="wgc-layer-tabs" role="tablist" aria-label={(mode==="required"?"其他必审条件":mode==="exempt"?"其他免审条件":"三方代付设置")+"层级"}>
    {records.map((record,index)=><button key={String(record.memberLevelId)+":"+index} type="button" role="tab" aria-selected={chosen===record.memberLevelId} className={chosen===record.memberLevelId?"active":""} onClick={()=>setSelected(Number(record.memberLevelId))}>{name(record.memberLevelId)}</button>)}
  </div><div className="wgc-layer-content" role="tabpanel" aria-label={name(chosen)}>{entry?<AmountFields entry={entry} mode={mode} merchants={merchants}/>:<span className="wgc-unknown">接口未提供该层级配置，不套用全局或其他层级值。</span>}</div></div>;
}

export function WGBrandSettings({setting,configuration}:{setting:WGConfigSetting;configuration:WGConfiguration}) {
  const s=setting as unknown as Values,d=configuration.dictionaries;
  const rules=object(s.otherConditionV2),condition=(key:string)=>object(rules[key]);
  const status=(key:string)=>typeof condition(key).status==="boolean"?condition(key).status as boolean:null;
  const field=(key:string,name:string,label:string)=><ReadValue value={condition(key)[name]} label={label}/>;
  const levels=d.levels.map(level=>({id:level.level_id,name:level.name}));
  const tags=d.tags.map(tag=>({id:tag.id,name:tag.name}));
  const merchants=d.merchants.map(merchant=>({id:merchant.id,name:merchant.value}));
  const discounts=array(condition("mustBeReceivedDiscount").specifiedDiscount);
  const structuredDiscounts=discounts.filter(value=>{
    const entry=object(value);
    return Object.keys(entry).length===3&&typeof entry.optType==="number"&&typeof entry.dealType==="number"&&Array.isArray(entry.activeIds)&&entry.activeIds.every(id=>typeof id==="number");
  }).map(object);
  const activities:TreeNode[]=d.activities.map(category=>({key:"o:"+category.optType,name:category.optTypeTxt,children:category.dealTypeList.map(deal=>({key:"d:"+category.optType+":"+deal.dealType,name:deal.dealTypeTxt,children:deal.activeList.map(active=>({key:"a:"+category.optType+":"+deal.dealType+":"+active.ActiveId,name:active.ActiveName,
    selected:structuredDiscounts.some(entry=>entry.optType===category.optType&&entry.dealType===deal.dealType&&(entry.activeIds as number[]).includes(active.ActiveId))?true:undefined}))}))}));
  const withdrawTypes:TreeNode[]=d.withdraw_types.map(type=>({key:"w:"+type.id,name:type.name,children:type.child.map(child=>({key:"c:"+type.id+":"+child.id,name:child.name}))}));
  const rule=(key:string,children:ReactNode)=><Check checked={status(key)}>{children}</Check>;
  const PIX=["CPF","PHONE","EMAIL","EVP","CNPJ","SLRY","SVGS","CACC","TRAN"];
  const pixEmpty=Array.isArray(s.PIXCondition)&&s.PIXCondition.length===0;
  return <div className="wgc-brand-settings">
    <Row label="免审出款开关" id="exemptSwitch"><Switch value={s.exemptSwitch} label="免审出款开关" off="关闭免审自动出款" on="开启免审自动出款"/></Row>
    <Row label="不免审原因备注开关" id="unavoidableCauseRemarkSwitch"><Switch value={s.unavoidableCauseRemarkSwitch} label="不免审原因备注开关" off="关闭不免审原因订单备注" on="开启不免审原因订单备注" mappingVerified={false}/></Row>
    <h4 className="wgc-section-heading">必须审核的情形 <span>（必审的级别高于免审，只要触发以下任意一条规则就必须审核）</span></h4>
    <Row label="必审会员层级" id="requiredLevelIds"><Selection selected={s.requiredLevelIds} options={levels} label="必审会员层级"/></Row>
    <Row label="必审会员标签" id="requiredTagIds"><Selection selected={s.requiredTagIds} options={tags} label="必审会员标签"/></Row>
    <Row label="不必审会员白名单" id="noRequiredTagIds"><p className="wgc-help">说明：选中会员标签不受必审条件限制，只要满足免审条件即可。</p><Selection selected={s.noRequiredTagIds} options={tags} label="不必审会员白名单"/></Row>
    <Row label="必审会员注册时长" id="requiredRegisterTime"><Registration value={s.requiredRegisterTime} required/></Row>
    <Row label="必审提现方式" id="requiredWithdrawTypes"><details className="wgc-dropdown"><summary>展开查看必审提现方式（只读）</summary><SelectionTree nodes={withdrawTypes} selected={rules.requiredWithdrawTypes} label="必审提现方式"/></details></Row>
    <Row label="必审账号提现次数" id="withdrawalAccountFirstWithdrawal">{rule("withdrawalAccountFirstWithdrawal",<>会员每个提现账号首次提现</>)}<details className="wgc-small-details"><summary>查看该条件的其他保存值</summary><pre>{literal(rules.withdrawalAccountFirstWithdrawal)}</pre></details></Row>
    <Row label="必审会员提现次数" id="firstFewWithdrawals">{rule("firstFewWithdrawals",<>会员前 {field("firstFewWithdrawals","value","必审前几次提现")} 次提现</>)}</Row>
    <Row label="打码和充提差额必审条件" id="requiredTurnover"><div className="wgc-rule-stack">
      {rule("rechargeWithdrawalBalanceDifference",<>近 {field("rechargeWithdrawalBalanceDifference","day","必审充提差额统计天数")} 天充提差额 ≤ {field("rechargeWithdrawalBalanceDifference","multiple","必审充提差额")}</>)}
      {rule("codingMultiple",<>近 {field("codingMultiple","day","必审打码统计天数")} 天打码倍数 ≤ {field("codingMultiple","multiple","必审打码倍数")} 倍</>)}
      {rule("depositAndWithdrawalDifference",<>累计充提差额比例 ≤ {field("depositAndWithdrawalDifference","ratio","必审充提差额比例")} %，且差额 ≤ {field("depositAndWithdrawalDifference","difference","必审累计充提差额")}</>)}
      {rule("memberSuccessWithdraw",<>会员已成功提现过 {field("memberSuccessWithdraw","severalTimes","已成功提现次数")} 次后，免以上 3 个条件</>)}
    </div></Row>
    <Row label="PIX 必须人工审核类型" id="PIXCondition"><div className="wgc-check-grid pix">{PIX.map(name=><Check key={name} checked={pixEmpty?false:null}>{name}</Check>)}</div>{!pixEmpty&&<small className="wgc-unknown">当前原值：{literal(s.PIXCondition)}；选项映射未核实。</small>}</Row>
    <Row label="风控类型必审条件" id="riskConditions"><div className="wgc-risk-grid">
      {rule("riskControlRulesAndNotAddressed","触发派奖监控风控规则且未处理")}{rule("gamblingRiskControlRulesAndNotAddressed","触发对赌监控风控规则且未处理")}
      {rule("firstDepositIsComplete","未完成首充")}{rule("depositAndWithdrawalCPFIsInconsistent","充提 CPF 不一致")}
      {rule("withdrawalIsRefusedOrCancelled",<>近 {field("withdrawalIsRefusedOrCancelled","value","被取消或拒绝提现天数")} 天被取消或被拒绝提现</>)}{rule("withdrawalIPDoesNotHaveTheSameName","该提现 IP 有相同姓名的会员账号")}
      {rule("manualDepositAudit",<>近 {field("manualDepositAudit","day","手动加款天数")} 天有手动加款</>)}{rule("withdrawalDeviceAccountNumber",<>该提现设备有 ≥ {field("withdrawalDeviceAccountNumber","value","同设备会员账号数量")} 个会员账号</>)}
      {rule("last3DaysSystemReleaseAudit",<>近 {field("last3DaysSystemReleaseAudit","day","系统解除稽核天数")} 天有系统解除稽核</>)}{rule("sportRollingBetProfit",<>体育滚球盘盈利 ≥ {field("sportRollingBetProfit","amount","体育滚球盘盈利")} USDT</>)}
    </div></Row>
    <Row label="领取过优惠必审条件" id="mustBeReceivedDiscount"><div className="wgc-bordered"><div className="wgc-inline">近 {field("mustBeReceivedDiscount","severalHours","领取优惠小时数")} 小时，领取过以下指定优惠必须审核</div>{structuredDiscounts.length>0&&<p className="wgc-help">仅标出完整优惠路径匹配的明确活动 ID；空 activeIds 或未匹配部分不推断为全选、全不选。</p>}<div className="wgc-tree-row"><span>领取指定优惠</span><SelectionTree nodes={activities} selected={condition("mustBeReceivedDiscount").specifiedDiscount} label="指定优惠"/></div></div></Row>
    <Row label="投注过以下游戏必审" help="（建议勾选容易套利的游戏）" id="betGameLimit"><div className="wgc-inline">近 <ReadValue value={object(s.betGameLimit).days} label="投注游戏统计时长"/> 小时，内投注过以下游戏必审</div><div className="wgc-game-missing"><strong>游戏名称与候选名单尚未同步</strong><p>不会按截图猜测游戏 ID 或选中状态；空 gameIds 不推断为全部游戏或没有游戏。</p><details><summary>查看游戏限制实际保存值</summary><pre>{JSON.stringify(s.betGameLimit,null,2)}</pre></details></div></Row>
    <Row label="其他必审条件" id="mustBeReviewedMemberLevelAmountList"><LayerRules entries={s.mustBeReviewedMemberLevelAmountList} levels={levels} merchants={merchants} mode="required"/></Row>
    <h4 className="wgc-section-heading">免审核的情形 <span>（满足以下任何一个条件的会员都自动免审，不填或填 0 表示不限制）</span></h4>
    <Row label="免审会员层级" id="levelIds"><Selection selected={s.levelIds} options={levels} label="免审会员层级"/></Row>
    <Row label="免审会员标签" id="tagIds"><Selection selected={s.tagIds} options={tags} label="免审会员标签"/></Row>
    <Row label="免审会员注册时长" id="registerTime"><Registration value={s.registerTime} required={false}/></Row>
    <Row label="免审提现方式" id="walletConditions"><div className="wgc-risk-grid">{rule("firstUseWalletWithdraw","首次使用三方钱包提现")}{rule("firstUseNoWalletWithdraw","首次使用 NO 钱包提现")}{rule("perUseWalletWithdraw","每次使用三方钱包提现")}{rule("perUseNoWalletWithdraw","每次使用 NO 钱包提现")}</div></Row>
    <Row label="免审提现次数" id="totalWithdrawalFrequency">{rule("totalWithdrawalFrequency",<>累计提现次数 ≥ {field("totalWithdrawalFrequency","severalTimes","免审累计提现次数")} 次</>)}</Row>
    <Row label="打码和充提差额免审条件" id="exemptTurnover"><div className="wgc-rule-stack">{rule("exemptRechargeWithdrawalDifference",<>近 {field("exemptRechargeWithdrawalDifference","day","免审充提差额统计天数")} 天累计充提差额 &gt; {field("exemptRechargeWithdrawalDifference","difference","免审充提差额")}</>)}{rule("exemptCodingMultiple",<>近 {field("exemptCodingMultiple","day","免审打码统计天数")} 天累计打码倍数 &gt; {field("exemptCodingMultiple","multiple","免审打码倍数")} 倍</>)}</div></Row>
    <Row label="其他免审条件" id="exemptMemberLevelAmount"><LayerRules entries={s.exemptMemberLevelAmount} levels={levels} merchants={merchants} mode="exempt"/></Row>
    <Row label="三方代付设置" id="paymentSettings"><LayerRules entries={s.exemptMemberLevelAmount} levels={levels} merchants={merchants} mode="payment"/></Row>
    <details className="wgc-technical"><summary>全局金额与其他独立保存值（只读）</summary><p className="wgc-help">全局币种记录与上方“全部层级”是两份独立配置，不相互覆盖，也不推断继承关系。金额按源值展示，未套用其他系统单位转换。</p>
      {([['mustBeReviewedAmountList','全局币种必审条件','required'],['exemptAmountList','全局币种免审条件','exempt']] as const).map(([key,label,mode])=><section key={key}><h4>{label}</h4>{amountRows(s[key]).map((entry,index)=><div className="wgc-global-record" key={index}><strong>{String(entry.currency||"未提供币种")}</strong><AmountFields entry={entry} mode={mode} merchants={merchants}/><details><summary>完整独立原值</summary><pre>{literal(entry)}</pre></details></div>)}</section>)}
      <h4>其他保留字段</h4><p className="wgc-help">以下字段的完整页面对应关系尚未核实，保留原值。</p><pre>{JSON.stringify({otherCondition:s.otherCondition,reviewBankCodeList:s.reviewBankCodeList,depositAndWithdrawalDifferenceGreaterThan0:rules.depositAndWithdrawalDifferenceGreaterThan0,accumulatedHistoricalLoss:rules.accumulatedHistoricalLoss},null,2)}</pre>
      <details><summary>查看当前品牌完整原值</summary><pre>{JSON.stringify(setting,null,2)}</pre></details>
    </details>
  </div>;
}

export default function WGConfigSheet({configuration,members}:{configuration:WGConfiguration;members:Array<{site_code:string;name:string}>}) {
  const [site,setSite]=useState("0");
  const keys=Object.keys(configuration.settings);
  const tabs=[...new Set(["0",...members.map(member=>String(member.site_code)),...keys])].filter(key=>keys.includes(key));
  const selected=tabs.includes(site)?site:tabs[0];
  const setting=configuration.settings[selected];
  const name=(key:string)=>key==="0"?"默认设置":(members.find(member=>String(member.site_code)===key)?.name||"品牌")+"（"+key+"）";
  return <div className="wgc-sheet" aria-label="WG 免人工审核自动出款只读配置">
    <div className="wgc-heading"><h3>免人工审核自动出款</h3><p>（免财务出款人工审核步骤，不含风控出款）</p></div>
    <div className="wgc-brand-tabs" role="tablist" aria-label="WG 品牌设置">{tabs.map(key=><button type="button" role="tab" aria-selected={selected===key} key={key} className={selected===key?"active":""} onClick={()=>setSite(key)}>{name(key)}</button>)}</div>
    {configuration.completeness.unavailable.length>0&&<div className="wgc-completeness" role="status">主配置已同步；{configuration.completeness.unavailable.map(key=>({games:"游戏名单",banks:"银行名单"}[key]||key)).join("、")}尚未提供。缺失选项不推断为关闭。</div>}
    {setting?<section role="tabpanel" aria-label={name(selected)}><WGBrandSettings key={selected} setting={setting} configuration={configuration}/></section>:<div className="awc-empty">当前品牌配置尚未提供。</div>}
    <p className="wgc-footnote">仅展示采集时的真实配置。品牌、层级和选项可展开查看；所有保存值不可修改，不会向 WG 源后台发送设置请求。</p>
  </div>;
}
