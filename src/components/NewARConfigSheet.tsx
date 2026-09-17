"use client";

import type {NewARConfiguration} from "@/lib/arAutoWithdrawConfigClient";

function valueText(value:string|number|boolean|null) {
  if(value===true)return "是";
  if(value===false)return "否";
  if(value===null||value==="")return "页面未提供";
  return String(value);
}

export default function NewARConfigSheet({configuration}:{configuration:NewARConfiguration}) {
  const available=configuration.fields.filter(field=>field.available).length;
  const ruleColumns=Array.from(new Set(configuration.channelRules.flatMap(rule=>Object.keys(rule))));
  return <div className="awc-sheet newar-config-sheet" aria-label="新AR自动出款配置完整只读展示">
    <div className="awc-sheet-intro"><strong>自动出款</strong><span>{available}/{configuration.fields.length} 项已采集 · {configuration.channels.length} 个渠道 · 每天同步一次</span></div>
    <p className="awc-source-intro">满足以下全部条件的订单可以进行自动出款</p>
    <div className="awc-columns"><span>配置条件</span><span>当前保存值</span><span>原页面说明</span></div>
    {configuration.fields.map(field=><div className={field.available?"awc-row":"awc-row awc-inactive"} key={field.key}>
      <div className="awc-label">{field.label}</div>
      <div className="awc-value">{field.available&&field.kind==="boolean"?<span className="awc-switch-value"><span className={field.value?"awc-switch on":"awc-switch"}><i/>{valueText(field.value)}</span></span>:field.available?<span className="awc-number">{valueText(field.value)}</span>:<span className="awc-unavailable">页面未提供</span>}</div>
      <div className="awc-description">{field.description||"—"}</div>
    </div>)}
    <section className="newar-config-section"><h3>渠道列表</h3><div className="newar-config-table-wrap"><table><thead><tr><th>ID</th><th>渠道名称</th><th>渠道地址</th><th>渠道类型</th></tr></thead><tbody>{configuration.channels.map(channel=><tr key={`${channel.id}:${channel.channelName}`}><td>{channel.id||"—"}</td><td>{channel.channelName||"—"}</td><td>{channel.channelUrl||"—"}</td><td>{channel.channelType||"—"}</td></tr>)}{!configuration.channels.length&&<tr><td colSpan={4}>页面未提供渠道</td></tr>}</tbody></table></div></section>
    <section className="newar-config-section"><h3>渠道规则</h3><div className="newar-config-table-wrap"><table><thead><tr>{ruleColumns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{configuration.channelRules.map((rule,index)=><tr key={index}>{ruleColumns.map(column=><td key={column}>{valueText(rule[column])}</td>)}</tr>)}{!configuration.channelRules.length&&<tr><td colSpan={Math.max(1,ruleColumns.length)}>当前只有默认渠道规则，未配置新增规则</td></tr>}</tbody></table></div></section>
    <div className="awc-footnote">只读镜像，不修改新AR后台；缺失字段显示“页面未提供”，不会推断为关闭或 0。</div>
  </div>;
}
