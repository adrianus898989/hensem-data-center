"use client";
import type {PandaConfiguration,PandaValue} from "@/lib/pandaAutoWithdrawConfigClient";
import "./PandaConfigSheet.css";

const KNOWN_LABELS:Record<string,string>={autoWithdrawalSwitch:"自动代付",autoWithdrawalAmountMix:"自动代付金额下限",autoWithdrawalAmountMax:"自动代付金额上限",autoRefuseSwitch:"代付失败自动驳回",autoWithdrawalLimitType:"首次提款限制",autoWithdrawalLimitAmount:"首次出款有效投注倍数",autoWithdrawalLimitLevel:"免审会员层级",autoWithdrawLimitRegTime:"免审会员注册时长",autoWithdrawLimitOther:"其他免审条件",autoWithdrawDailyLimit:"会员单日累计提现金额免审限制",autoWithdrawManualRechargeLimit:"单笔人工存入限制",autoWithdrawManualGiftLimit:"单笔人工优惠 / 单笔批量人工优惠限制",successRateType:"成功率配置",orderVolume:"接单量",minSuccessRate:"成功率低于"};
const KNOWN_VALUES:Record<string,Record<string,string>>={autoWithdrawalLimitType:{validBet:"需要达到有效投注"},autoWithdrawLimitRegTime:{noLimit:"不限"},successRateType:{Number:"按接单量成功率"}};
const OTHER_CONDITIONS:Record<string,string>={AgentWithdrawalsReviewed:"代理提现必须审核（多次）",AgentWithdrawalsReviewedOnce:"代理提现必须审核（一次）",RollBackGameRecord:"游戏撤单后首笔提现必须审核"};
const MONEY_UNVERIFIED=["autoWithdrawDailyLimit","autoWithdrawManualRechargeLimit","autoWithdrawManualGiftLimit"];
const BASIC=["autoWithdrawalSwitch","autoWithdrawalAmountMix","autoWithdrawalAmountMax","autoRefuseSwitch"];
const CONDITIONS=["autoWithdrawalLimitType","autoWithdrawalLimitAmount","autoWithdrawalLimitLevel","autoWithdrawLimitRegTime",...MONEY_UNVERIFIED,"autoWithdrawLimitOther"];
const CHANNEL_RULES=["successRateType","orderVolume","minSuccessRate"];
const EXTRA=["withdrawSwitch","rechargeMultiple","rewardMultiple","auditAutoRelieve","autoWithdrawalLimitSwitch","autoWithdrawalPollingSwitch","auditAutoRelieveType","auditLevelMode","levelMultiples"];
function literal(value:PandaValue):string{return typeof value==="object"?JSON.stringify(value,null,2):String(value);}
function Shape({value}:{value:PandaValue}){
  if(value===null)return <span className="pwc-muted">接口返回空值</span>;
  if(Array.isArray(value))return value.length?<div className="pwc-tags">{value.map((v,i)=><span key={i}>{typeof v==="object"?<pre>{literal(v)}</pre>:String(v)}</span>)}</div>:<span className="pwc-muted">无条目（[]）</span>;
  return typeof value==="object"?<pre className="pwc-json">{literal(value)}</pre>:<span>{String(value)}</span>;
}
export default function PandaConfigSheet({configuration}:{configuration:PandaConfiguration}){
  const {values:v,unavailable_fields:missing}=configuration;
  const available=(key:string)=>Object.hasOwn(v,key)&&!missing.includes(key);
  const value=(key:string)=>{
    if(!available(key))return <span className="pwc-muted">接口未提供</span>;
    const item=v[key];
    if(item===null)return <Shape value={item}/>;
    if(key==="autoWithdrawalAmountMix"||key==="autoWithdrawalAmountMax")return typeof item==="number"?<span className="pwc-number">{(item/100).toFixed(2)}<small>原值 {item}</small></span>:<Shape value={item}/>;
    if(MONEY_UNVERIFIED.includes(key)&&typeof item==="number")return <span className="pwc-number">{item===0?"0.00":item}<small>{item===0?"接口原值 0":"接口原值 · 非零金额单位待核对"}</small></span>;
    if(typeof item==="boolean"||key==="autoRefuseSwitch"&&["ON","OFF"].includes(String(item))){
      const on=item===true||item==="ON";
      return <span className={"pwc-switch "+(on?"on":"")} role="img" aria-label={on?"开启（只读）":"关闭（只读）"}><i/>{on?"开启":"关闭"}</span>;
    }
    if(key==="autoWithdrawalLimitAmount"&&typeof item==="number")return <span className="pwc-number">{item} 倍</span>;
    if(key==="minSuccessRate"&&typeof item==="number")return <span className="pwc-number">{item.toFixed(2)}%<small>{item===0?"不限制成功率":"低于此值，则自动下架"}</small></span>;
    if(key==="orderVolume"&&typeof item==="number")return <span className="pwc-number">{item}<small>{item===0?"不限制接单量":"按此接单量计算成功率"}</small></span>;
    if(key==="autoWithdrawLimitOther"&&Array.isArray(item))return item.length?<div className="pwc-selected-list">{item.map((code,i)=><span key={i}><b aria-hidden="true">✓</b><span>{OTHER_CONDITIONS[String(code)]||"未解析条件"}<small>{String(code)}</small></span></span>)}</div>:<span className="pwc-muted">未选择其他条件</span>;
    if(key==="autoWithdrawalLimitLevel"&&Array.isArray(item))return item.length?<span>已选层级 ID：{item.map(String).join("、")}<small className="pwc-enum">名称字典未提供，按 ID 展示</small></span>:<span className="pwc-muted">未选择会员层级</span>;
    const label=KNOWN_VALUES[key]?.[String(item)];
    return label?<span>{label}<small className="pwc-enum">{String(item)}</small></span>:<Shape value={item}/>;
  };
  const row=(key:string)=><div className="pwc-row" key={key} data-field={key}><div className="pwc-label">{KNOWN_LABELS[key]||key}{KNOWN_LABELS[key]&&<small>{key}</small>}</div><div className="pwc-value">{value(key)}</div></div>;
  const channelValue=v.autoWithdrawalChannel;
  const channels=Array.isArray(channelValue)?channelValue:[];
  return <div className="pwc-sheet" aria-label="熊猫自动出款配置只读展示">
    <div className="pwc-sheet-heading"><h3>代付设置</h3><span>{Object.keys(v).length}/26 项已提供 · 只读</span></div>
    {BASIC.map(row)}
    <p className="pwc-help">金额按原后台显示单位展示，保留接口原值；0～0 表示不限制范围。</p>
    <h4>免审条件</h4><p className="pwc-help">同时满足以下设置条件的会员才能自动免审；不填表示不限制。</p>
    {CONDITIONS.map(row)}
    <p className="pwc-help">其他免审条件按接口已选项展示；未知枚举保留原码，不推断含义。金额限制的非零单位待原页面核对。</p>
    <h4>自动代付渠道下架规则</h4>
    <p className="pwc-help">若按成功率判断，成功率未达到设置值时，该自动代付渠道自动下架。</p>
    {CHANNEL_RULES.map(row)}
    <h4>自动代付通道</h4>
    {!available("autoWithdrawalChannel")||channelValue===null?<div className="pwc-row">{value("autoWithdrawalChannel")}</div>:channels.length===0?<p className="pwc-help">未配置通道</p>:
      <div className="pwc-table-wrap"><table><thead><tr><th>下架方式</th><th>通道 ID</th><th>提现类型</th><th>类型 ID / 代码</th></tr></thead><tbody>{channels.map((item,i)=>{
        const c=item as Record<string,PandaValue>;return <tr key={i}><td>{c.pullOffType==="SuccessRate"?"按成功率":String(c.pullOffType)}<small className="pwc-enum">{String(c.pullOffType)}</small></td><td>{String(c.withdrawalChannelId)}</td><td>{String(c.tenantWithdrawTypeName)}</td><td>{String(c.tenantWithdrawTypeId)} / {String(c.tenantWithdrawTypeCode)}</td></tr>;
      })}</tbody></table></div>}
    <p className="pwc-help">接口未提供通道名称，按原始 ID 展示；PIX 是提现类型，不是通道名称。</p>
    <h4>游戏限制配置 <code>auditGameLimit</code></h4>
    <div className="pwc-nested">{value("auditGameLimit")}</div>
    <p className="pwc-help">游戏平台、游戏名称字典未提供，保留类型代码和完整 ID，不推断名称。</p>
    <h4>其它接口配置</h4><p className="pwc-help">以下字段尚未取得完整原页面名称与单位，按接口字段和保存值展示，不推断生效关系。</p>
    {EXTRA.map(row)}
    {missing.length>0&&<p className="pwc-help">本次接口未提供：{missing.join("、")}</p>}
    <details className="pwc-raw"><summary>查看本次完整配置字段</summary><pre>{JSON.stringify(configuration,null,2)}</pre></details>
    <p className="pwc-footnote">每天同步一次，非实时配置。此页面没有编辑或保存功能，不会修改熊猫后台。</p>
  </div>;
}
