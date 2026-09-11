"use client";
import type {PandaConfiguration,PandaValue} from "@/lib/pandaAutoWithdrawConfigClient";
import "./PandaConfigSheet.css";

const KNOWN_LABELS:Record<string,string>={autoWithdrawalSwitch:"自动代付",autoWithdrawalAmountMix:"自动代付金额下限",autoWithdrawalAmountMax:"自动代付金额上限",autoRefuseSwitch:"代付失败自动驳回",autoWithdrawalLimitType:"首次提款限制",autoWithdrawalLimitAmount:"首次出款有效投注倍数",autoWithdrawalLimitLevel:"免审会员层级",autoWithdrawLimitRegTime:"免审会员注册时长",autoWithdrawLimitOther:"其他免审条件",autoWithdrawDailyLimit:"会员单日累计提现金额免审限制",autoWithdrawManualRechargeLimit:"单笔人工存入限制",autoWithdrawManualGiftLimit:"单笔人工优惠 / 单笔批量人工优惠限制",successRateType:"成功率配置",orderVolume:"接单量",minSuccessRate:"成功率低于"};
const KNOWN_VALUES:Record<string,Record<string,string>>={autoWithdrawalLimitType:{validBet:"需要达到有效投注",firstWithdraw:"会员首次提现必须审核"},autoWithdrawLimitRegTime:{noLimit:"不限"},successRateType:{Number:"按接单量成功率"}};
// Only these mappings have been verified against the source interface.
const OTHER_CONDITIONS:Record<string,string>={AgentWithdrawalsReviewed:"代理提现必须审核（多次）",AgentWithdrawalsReviewedOnce:"代理提现必须审核（一次）",RollBackGameRecord:"游戏撤单后首笔提现必须审核",MembersWithPositiveDepositWithdrawalDifference:"充提差额大于0的会员才免审核"};
const MONEY_UNVERIFIED=["autoWithdrawDailyLimit","autoWithdrawManualRechargeLimit","autoWithdrawManualGiftLimit"];
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
  const input=(key:string,text:string,compact=false)=><input className={"pwc-input"+(compact?" pwc-input-compact":"")} aria-label={(KNOWN_LABELS[key]||key)+"（只读）"} value={text} readOnly/>;
  const select=(label:string,text:string)=><select className="pwc-select" aria-label={label+"（只读）"} value={text} disabled><option value={text}>{text}</option></select>;
  const value=(key:string)=>{
    if(!available(key))return <span className="pwc-muted">接口未提供</span>;
    const item=v[key];
    if(item===null)return <Shape value={item}/>;
    if(key==="autoWithdrawalAmountMix"||key==="autoWithdrawalAmountMax")return typeof item==="number"?input(key,(item/100).toFixed(2)):<Shape value={item}/>;
    if(MONEY_UNVERIFIED.includes(key)&&typeof item==="number")return <>{input(key,item===0?"0.00":String(item))}{item!==0&&<small className="pwc-field-help">接口原值；金额单位尚未核实</small>}</>;
    if(typeof item==="boolean"||key==="autoRefuseSwitch"&&["ON","OFF"].includes(String(item))){
      const on=item===true||item==="ON";
      return <span className={"pwc-switch "+(on?"on":"")} role="img" aria-label={on?"开启（只读）":"关闭（只读）"}><i/>{on?"开启":"关闭"}</span>;
    }
    if(key==="autoWithdrawalLimitAmount"&&typeof item==="number")return <div className="pwc-inline">{input(key,String(item),true)}<span>倍</span></div>;
    if(key==="minSuccessRate"&&typeof item==="number")return <><div className="pwc-inline">{input(key,item.toFixed(2),true)}<span>%，则自动下架</span></div><small className="pwc-field-help pwc-warning">不输入或者 0，表示不限制成功率</small></>;
    if(key==="orderVolume"&&typeof item==="number")return <>{input(key,String(item))}<small className="pwc-field-help pwc-warning">不输入或者 0，表示不限制接单量</small></>;
    if(key==="successRateType"&&item==="Number")return <div className="pwc-radio-list" role="group" aria-label="成功率配置（只读）"><label><input type="radio" checked disabled/>按接单量成功率</label><label><input type="radio" checked={false} disabled/>按历史成功率</label></div>;
    if(key==="autoWithdrawalLimitType"&&typeof item==="string"&&Object.hasOwn(KNOWN_VALUES.autoWithdrawalLimitType,item))return <div className="pwc-radio-list" role="group" aria-label="首次提款限制（只读）">{Object.entries(KNOWN_VALUES.autoWithdrawalLimitType).map(([code,label])=><label key={code}><input type="radio" checked={item===code} disabled/>{label}</label>)}</div>;
    if(key==="autoWithdrawLimitOther"&&Array.isArray(item)){
      const selected=new Set(item.map(String));
      return <div className="pwc-check-list" role="group" aria-label="其他免审条件（只读）">
        {Object.entries(OTHER_CONDITIONS).map(([code,name])=><label key={code}><input type="checkbox" checked={selected.has(code)} disabled/>{name}</label>)}
        {[...selected].filter(code=>!Object.hasOwn(OTHER_CONDITIONS,code)).map(code=><label key={code}><input type="checkbox" checked disabled/><span>未映射条件：{code}</span></label>)}
        <small className="pwc-field-help">显示已核实名称的条件；未映射的已选项保留原码。</small>
      </div>;
    }
    if(key==="autoWithdrawalLimitLevel"&&Array.isArray(item))return item.length?<div className="pwc-check-list" role="group" aria-label="免审会员层级（只读）">{item.map((id,i)=><label key={i}><input type="checkbox" checked disabled/>层级 ID：{String(id)}</label>)}<small className="pwc-field-help">已选层级按真实 ID 显示；源后台名称字典尚未同步。</small></div>:<span className="pwc-muted">未选择会员层级（[]）</span>;
    if(key==="auditGameLimit"&&typeof item==="object"&&!Array.isArray(item)&&Object.keys(item).length===0)return <span className="pwc-muted">接口返回空对象（{"{}"}）</span>;
    const label=KNOWN_VALUES[key]?.[String(item)];
    return label?select(KNOWN_LABELS[key],label):<Shape value={item}/>;
  };
  const row=(key:string)=><div className="pwc-row" key={key} data-field={key}><div className="pwc-label">{KNOWN_LABELS[key]||key}：</div><div className="pwc-value">{value(key)}</div></div>;
  const channelValue=v.autoWithdrawalChannel;
  const channels=Array.isArray(channelValue)?channelValue:[];
  return <div className="pwc-sheet" aria-label="熊猫自动出款配置只读展示">
    <div className="pwc-sheet-heading"><h3>代付设置</h3><span>只读配置 · 每日同步</span></div>
    {row("autoWithdrawalSwitch")}
    <div className="pwc-row" data-field="autoWithdrawalAmountMix"><div className="pwc-label">自动代付金额范围：</div><div className="pwc-value"><div className="pwc-amount-range">{value("autoWithdrawalAmountMix")}<span>~</span><div data-field="autoWithdrawalAmountMax">{value("autoWithdrawalAmountMax")}</div></div><small className="pwc-field-help pwc-warning">不输入或者 0~0，表示不限制范围</small></div></div>
    {row("autoRefuseSwitch")}
    <h4>免审条件</h4><p className="pwc-help">同时满足以下设置条件的会员才能自动免审；不填表示不限制。</p>
    {CONDITIONS.map(row)}
    <h4>自动代付渠道下架规则 <span>（若按成功率判断，成功率未达到设置值时，该自动代付渠道自动下架）</span></h4>
    {CHANNEL_RULES.map(row)}
    <div className="pwc-row pwc-channel-row"><div className="pwc-label">自动代付渠道：</div><div className="pwc-value">
      <div className="pwc-channel-head"><span>下架方式</span><span>代付渠道</span></div>
      {!available("autoWithdrawalChannel")||channelValue===null?<div>{value("autoWithdrawalChannel")}</div>:channels.length===0?<p className="pwc-muted">未配置通道</p>:
        <div className="pwc-channels">{channels.map((item,i)=>{
          const c=item as Record<string,PandaValue>;
          return <div className="pwc-channel" key={i}>{select("渠道 "+(i+1)+" 下架方式",c.pullOffType==="SuccessRate"?"按成功率":String(c.pullOffType))}<div>{select("代付渠道 "+(i+1),"通道 ID："+String(c.withdrawalChannelId))}<small className="pwc-channel-meta">提现类型：{String(c.tenantWithdrawTypeName)}</small></div></div>;
        })}</div>}
      <small className="pwc-field-help">接口尚未提供渠道名称，暂按 ID 展示；PIX 是提现类型。</small>
    </div></div>
    <details className="pwc-technical"><summary>技术详情 · 接口字段与未映射配置</summary>
    <p className="pwc-help">已保留 {Object.keys(v).length}/26 项接口字段。此处展示原值，不推断未核实的单位或名称。</p>
    <h4>游戏限制配置 <code>auditGameLimit</code></h4>
    <div className="pwc-nested">{value("auditGameLimit")}</div>
    <p className="pwc-help">游戏平台、游戏名称字典未提供，保留类型代码和完整 ID，不推断名称。</p>
    <h4>其它接口配置</h4><p className="pwc-help">以下字段尚未取得完整原页面名称与单位，按接口字段和保存值展示，不推断生效关系。</p>
    {EXTRA.map(row)}
    {missing.length>0&&<p className="pwc-help">本次接口未提供：{missing.join("、")}</p>}
    <details className="pwc-raw"><summary>查看完整配置原值</summary><pre>{JSON.stringify(configuration,null,2)}</pre></details>
    </details>
    <p className="pwc-footnote">仅展示采集时的配置，不会修改熊猫后台。渠道名称与未映射项核实后再补齐。</p>
  </div>;
}
