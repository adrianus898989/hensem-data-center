"use client";
import type {PandaConfiguration,PandaDictionary,PandaValue} from "@/lib/pandaAutoWithdrawConfigClient";
import catalog from "../lib/pandaConfigOptionCatalog.json";
import "./PandaConfigSheet.css";

const KNOWN_LABELS:Record<string,string>={autoWithdrawalSwitch:"自动代付",autoWithdrawalAmountMix:"自动代付金额下限",autoWithdrawalAmountMax:"自动代付金额上限",autoRefuseSwitch:"代付失败自动驳回",autoWithdrawalLimitType:"首次提款限制",autoWithdrawalLimitAmount:"首次出款有效投注倍数",autoWithdrawalLimitLevel:"免审会员层级",autoWithdrawLimitRegTime:"免审会员注册时长",autoWithdrawLimitOther:"其他免审条件",autoWithdrawDailyLimit:"会员单日累计提现金额免审限制",autoWithdrawManualRechargeLimit:"单笔人工存入限制",autoWithdrawManualGiftLimit:"单笔人工优惠 / 单笔批量人工优惠限制",successRateType:"成功率配置",orderVolume:"接单量",minSuccessRate:"成功率低于"};
const RADIO_OPTIONS:Record<string,{code:string;label:string}[]>={autoWithdrawalLimitType:catalog.autoWithdrawalLimitType.options,autoWithdrawLimitRegTime:catalog.autoWithdrawLimitRegTime.options,successRateType:catalog.successRateType.options};
// Every enum, order and tooltip is verified against the captured source components.
const OTHER_OPTIONS=catalog.autoWithdrawLimitOther.options;
function OptionInfo({label,children}:{label:string;children:React.ReactNode}){
  return <details className="pwc-option-info"><summary aria-label={label+"：查看说明（只读）"}>ⓘ</summary><div>{children}</div></details>;
}
const MONEY_FIELDS=["autoWithdrawDailyLimit","autoWithdrawManualRechargeLimit","autoWithdrawManualGiftLimit"];
const CONDITIONS=["autoWithdrawalLimitType","autoWithdrawalLimitAmount","autoWithdrawalLimitLevel","autoWithdrawLimitRegTime",...MONEY_FIELDS,"autoWithdrawLimitOther"];
const CHANNEL_RULES=["successRateType","orderVolume","minSuccessRate"];
const EXTRA=["withdrawSwitch","rechargeMultiple","rewardMultiple","auditAutoRelieve","autoWithdrawalLimitSwitch","autoWithdrawalPollingSwitch","auditAutoRelieveType","auditLevelMode","levelMultiples"];
function literal(value:PandaValue):string{return typeof value==="object"?JSON.stringify(value,null,2):String(value);}
function Shape({value}:{value:PandaValue}){
  if(value===null)return <span className="pwc-muted">接口返回空值</span>;
  if(Array.isArray(value))return value.length?<div className="pwc-tags">{value.map((v,i)=><span key={i}>{typeof v==="object"?<pre>{literal(v)}</pre>:String(v)}</span>)}</div>:<span className="pwc-muted">无条目（[]）</span>;
  return typeof value==="object"?<pre className="pwc-json">{literal(value)}</pre>:<span>{String(value)}</span>;
}
export default function PandaConfigSheet({configuration,countryCode,platform,dictionary}:{configuration:PandaConfiguration;countryCode?:string;platform?:string;dictionary?:PandaDictionary|null}){
  const {values:v,unavailable_fields:missing}=configuration;
  // Never reuse a dictionary across platforms, even when the numeric IDs happen to match.
  const names=dictionary&&dictionary.country_code===countryCode&&dictionary.platform===platform?dictionary:null;
  const otherOptions=OTHER_OPTIONS.filter(o=>!("source_visibility" in o)||o.source_visibility?.country_codes.includes(countryCode||""));
  const available=(key:string)=>Object.hasOwn(v,key)&&!missing.includes(key);
  const input=(key:string,text:string,compact=false)=><input className={"pwc-input"+(compact?" pwc-input-compact":"")} aria-label={(KNOWN_LABELS[key]||key)+"（只读）"} value={text} readOnly/>;
  const browse=(label:string,current:string,options:{code:string;label:string}[],selected:string)=><details className="pwc-browse"><summary aria-label={label+"：展开查看选项（只读）"}>{current}<span aria-hidden="true">⌄</span></summary><ul aria-label={label+"选项（不可修改）"}>{options.map(o=><li key={o.code} className={o.code===selected?"selected":""}><span aria-hidden="true">{o.code===selected?"✓":""}</span>{o.label}{o.code===selected&&<small>当前</small>}</li>)}</ul></details>;
  const value=(key:string)=>{
    if(!available(key))return <span className="pwc-muted">接口未提供</span>;
    const item=v[key];
    if(item===null)return <Shape value={item}/>;
    if(key==="autoWithdrawalAmountMix"||key==="autoWithdrawalAmountMax")return typeof item==="number"?input(key,(item/100).toFixed(2)):<Shape value={item}/>;
    if(MONEY_FIELDS.includes(key)&&typeof item==="number")return input(key,(Math.floor(item)/100).toFixed(2));
    if(typeof item==="boolean"||key==="autoRefuseSwitch"&&["ON","OFF"].includes(String(item))){
      const on=item===true||item==="ON";
      return <span className={"pwc-switch "+(on?"on":"")} role="img" aria-label={on?"开启（只读）":"关闭（只读）"}><i/>{on?"开启":"关闭"}</span>;
    }
    if(key==="autoWithdrawalLimitAmount"&&typeof item==="number")return <><div className="pwc-inline">{input(key,String(item),true)}<span>倍</span></div><small className="pwc-field-help pwc-warning">第一次出款，需要达到对应的有效投注倍数</small></>;
    if(key==="minSuccessRate"&&typeof item==="number")return <><div className="pwc-inline">{input(key,item.toFixed(2),true)}<span>%，则自动下架</span></div><small className="pwc-field-help pwc-warning">不输入或者 0，表示不限制成功率</small></>;
    if(key==="orderVolume"&&typeof item==="number")return <>{input(key,String(item))}<small className="pwc-field-help pwc-warning">不输入或者 0，表示不限制接单量</small></>;
    if(RADIO_OPTIONS[key]&&typeof item==="string"){
      const options=RADIO_OPTIONS[key],known=options.some(o=>o.code===item);
      return <><div className={"pwc-radio-list"+(key==="autoWithdrawLimitRegTime"?" pwc-registration-options":"")} role="group" aria-label={KNOWN_LABELS[key]+"（只读）"}>{options.map(({code,label})=><label key={code}>{known?<input type="radio" checked={item===code} disabled/>:<span className="pwc-unknown-choice pwc-unknown-radio" role="img" aria-label="选中状态未核实">?</span>}{label}</label>)}{key==="successRateType"&&<OptionInfo label="成功率配置">{catalog.successRateType.field_help.map(h=><p key={h.key}>{h.text}</p>)}</OptionInfo>}</div>{!known&&<small className="pwc-field-help">当前接口原值：{item}；未知选项，不推断选中状态。</small>}</>;
    }
    if(key==="autoWithdrawLimitOther"&&Array.isArray(item)){
      const selected=new Set(item.map(String));
      const unknown=[...selected].filter(code=>!otherOptions.some(o=>o.code===code));
      return <div className="pwc-check-list" role="group" aria-label="其他免审条件（只读）">
        {otherOptions.map(({code,label,tooltip})=><div className="pwc-condition" key={code}><label><input type="checkbox" checked={selected.has(code)} disabled/>{label}</label><OptionInfo label={label}>{tooltip}</OptionInfo></div>)}
        {unknown.length>0&&<div className="pwc-unmapped"><small className="pwc-field-help">以下为源接口已选项，不属于本地区已核实的选项名单，保留原码。</small>{unknown.map(code=><label key={code}><input type="checkbox" checked disabled/><span>未映射条件：{code}</span></label>)}</div>}
      </div>;
    }
    if(key==="autoWithdrawalLimitLevel"&&Array.isArray(item)){
      const levels=names?.levels||[],unmapped=item.filter(id=>!levels.some(l=>l.id===id));
      return <div className="pwc-check-list" role="group" aria-label="免审会员层级（只读）">{names&&<><label className="pwc-level-all"><input type="checkbox" checked={levels.length>0&&levels.every(l=>item.includes(l.id))&&unmapped.length===0} disabled/>全选</label><div className="pwc-level-grid">{levels.map(l=><label key={l.id} title={"层级 ID："+l.id}><input type="checkbox" checked={item.includes(l.id)} disabled/>{l.name}</label>)}</div></>}{unmapped.length>0&&<div className="pwc-level-grid">{unmapped.map((id,i)=><label key={i}><input type="checkbox" checked disabled/>层级 ID：{String(id)}</label>)}</div>}{!names&&<small className="pwc-field-help">{item.length?"已选层级按真实 ID 显示；源后台名称字典尚未同步。":"未选择会员层级（[]）；完整层级名单待同步。"}</small>}{names&&unmapped.length>0&&<small className="pwc-field-help">部分已选 ID 不在本次字典内，已保留原值。</small>}{names&&levels.length===0&&<span className="pwc-muted">源后台层级名单为空</span>}</div>;
    }
    if(key==="auditGameLimit"&&typeof item==="object"&&!Array.isArray(item)&&Object.keys(item).length===0)return <span className="pwc-muted">接口返回空对象（{"{}"}）</span>;
    return <Shape value={item}/>;
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
    {CONDITIONS.filter(key=>key!=="autoWithdrawalLimitAmount"||available("autoWithdrawalLimitType")&&v.autoWithdrawalLimitType==="validBet").map(row)}
    <h4>自动代付渠道下架规则 <span>（若按成功率判断，成功率未达到设置值时，该自动代付渠道自动下架）</span></h4>
    {CHANNEL_RULES.map(row)}
    <div className="pwc-row pwc-channel-row"><div className="pwc-label">自动代付渠道：</div><div className="pwc-value">
      <div className="pwc-channel-head"><span>下架方式</span><span>代付渠道</span></div>
      {!available("autoWithdrawalChannel")||channelValue===null?<div>{value("autoWithdrawalChannel")}</div>:channels.length===0?<p className="pwc-muted">未配置通道</p>:
        <div className="pwc-channels">{channels.map((item,i)=>{
          const c=item as Record<string,PandaValue>;
          const options=(names?.channels||[]).filter(n=>n.withdraw_type_id===c.tenantWithdrawTypeId).map(n=>({code:String(n.id),label:n.name}));
          const current=options.find(n=>n.code===String(c.withdrawalChannelId));
          const label=current?.label||"通道 ID："+String(c.withdrawalChannelId);
          if(!current)options.unshift({code:String(c.withdrawalChannelId),label});
          const pull=String(c.pullOffType),pullLabel=catalog.pullOffType.options.find(o=>o.code===pull)?.label||pull;
          return <div className="pwc-channel" key={i}>{browse("渠道 "+(i+1)+" 下架方式",pullLabel,catalog.pullOffType.options,pull)}<div>{browse("代付渠道 "+(i+1),label,options,String(c.withdrawalChannelId))}<small className="pwc-channel-meta">提现类型：{String(c.tenantWithdrawTypeName)}</small></div></div>;
        })}</div>}
      <small className="pwc-field-help">{names?"可展开查看本平台渠道选项，不能修改。":"渠道名称字典尚未同步，暂按 ID 展示；PIX 是提现类型。"}</small>
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
    <p className="pwc-footnote">仅展示采集时的配置，不会修改熊猫后台。{names?"名称字典采集日期："+names.observed_local_date+"。":"层级、通道名称需运行新版采集程序补齐。"}</p>
  </div>;
}
