"use client";

import type {NewARConfiguration} from "@/lib/arAutoWithdrawConfigClient";

function valueText(value:string|number|boolean|null|undefined|Array<string|number|boolean|null>) {
  if(value===true)return "是";
  if(value===false)return "否";
  if(value===null||value===undefined)return "页面未提供";
  if(value==="")return "空值";
  if(Array.isArray(value))return value.map(v=>String(v??"空值")).join("、")||"空列表";
  return String(value);
}

export default function NewARConfigSheet({configuration}:{configuration:NewARConfiguration}) {
  const overviewFields=configuration.settingGroups?configuration.fields.filter(f=>f.key==="autoWithdraw"):configuration.fields;
  const available=configuration.fields.filter(field=>field.available).length;
  const ruleColumns=Array.from(new Set(configuration.channelRules.flatMap(rule=>Object.keys(rule))));
  return <div className="awc-sheet newar-config-sheet" aria-label="新AR自动出款配置完整只读展示">
    <div className="awc-sheet-intro"><strong>自动出款</strong><span>{configuration.settingGroups ? `${configuration.settingGroups.length} 组规则` : `${available}/${configuration.fields.length} 项已采集`} · {configuration.channels.length} 个渠道 · 每天同步一次</span></div>
    <p className="awc-source-intro">满足以下全部条件的订单可以进行自动出款</p>
    <div className="awc-columns"><span>配置条件</span><span>当前保存值</span><span>原页面说明</span></div>
    {overviewFields.map(field=><div className={field.available?"awc-row":"awc-row awc-inactive"} key={field.key}>
      <div className="awc-label">{field.label}</div>
      <div className="awc-value">{field.available&&field.kind==="boolean"?<span className="awc-switch-value"><span className={field.value?"awc-switch on":"awc-switch"}><i/>{valueText(field.value)}</span></span>:field.available?<span className="awc-number">{valueText(field.value)}</span>:<span className="awc-unavailable">页面未提供</span>}</div>
      <div className="awc-description">{field.description||"—"}</div>
    </div>)}
    <section className="newar-config-section"><h3>渠道列表</h3><div className="newar-config-table-wrap"><table><thead><tr><th>ID</th><th>渠道名称</th><th>渠道地址</th><th>渠道类型</th></tr></thead><tbody>{configuration.channels.map(channel=><tr key={`${channel.id}:${channel.channelName}`}><td>{channel.id||"—"}</td><td>{channel.channelName||"—"}</td><td>{channel.channelUrl||"—"}</td><td>{channel.channelType||"—"}</td></tr>)}{!configuration.channels.length&&<tr><td colSpan={4}>页面未提供渠道</td></tr>}</tbody></table></div></section>
    <section className="newar-config-section"><h3>渠道规则</h3><div className="newar-config-table-wrap"><table><thead><tr>{ruleColumns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{configuration.channelRules.map((rule,index)=><tr key={index}>{ruleColumns.map(column=><td key={column}>{valueText(rule[column])}</td>)}</tr>)}{!configuration.channelRules.length&&<tr><td colSpan={Math.max(1,ruleColumns.length)}>接口未提供独立渠道关联规则</td></tr>}</tbody></table></div></section>
    {configuration.settingGroups?.map((group,index)=><section className="newar-config-section" key={String(group.id??index)}>
      <h3>{String(group.configName||"渠道规则")} · ID {String(group.id??"—")}</h3>
      <div className="newar-config-table-wrap"><table><thead><tr><th>配置条件 / 原字段</th><th>当前保存值</th></tr></thead>
        <tbody>{Object.entries(group).map(([key,value])=><tr key={key}><td>{SETTING_LABELS[key]||key} <small>{key}</small></td><td>{valueText(value)}</td></tr>)}</tbody>
      </table></div>
    </section>)}
    <div className="awc-footnote">只读镜像，不修改新AR后台；缺失字段显示“页面未提供”，不会推断为关闭或 0。</div>
  </div>;
}

const SETTING_LABELS:Record<string,string>={
  id:"规则编号",configName:"规则名称",configState:"规则启用状态",allowVirtualWithdraw:"允许虚拟币提现",
  maxWithdrawAmount:"提现金额",maxWithdrawTime:"提现次数",grandWithdrawTotal:"累计提现次数",maxWithdrawRechargeRate:"总提现 / 总充值",
  needFirstRecharge:"需要首充",needUserNoRemark:"用户无备注",needLimitGroup:"用户组限制开关",limitGroup:"用户组范围",
  dayProfitAmount:"当日盈利金额",manualRechargeOf3Day:"三日内人工充值",bonusRechargeOf3Day:"三日内彩金充值",balance:"账号余额",
  firstDepositAmount:"首充金额",sameDeviceRegistCount:"同设备注册数",allowInvitedWheelAutoWithdraw:"邀请转盘自动出款",
  sameIpRegistCount:"同 IP 注册数",sameBankAccountCount:"相同银行账号数",checkRejectPackage:"拒绝渠道检查",rejectPackageIds:"拒绝渠道 ID",
  totalRechargeAmountOpreationType:"总充值金额比较方式",totalRechargeAmount:"总充值金额",checkLowOddsOrderRatio:"低赔率订单占比检查",
  lowOdds:"低赔率",lowOddsOrderRatio:"低赔率订单占比",checkRiskList:"风险名单检查",checkBlackListUserIdAndIp:"用户 ID / IP 黑名单检查",
  totalWinLoseAmount:"累计输赢金额",autoWithdrawFailCount:"自动出款失败次数",totalCodingAmountMultiple:"累计打码倍数",
  totalCodingAmountMultipleWithBonus:"含彩金累计打码倍数",allowPackageIds:"允许渠道 ID",isDefaultConfig:"默认规则"
};
