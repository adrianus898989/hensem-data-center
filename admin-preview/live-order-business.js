/* Shared, allowlisted business fields for every single-order drawer. */
(function(root){
 'use strict';
 function rows(r,p,{E,N,formatTime}){
  const lg=String(p?.source||'').toLowerCase()==='lg';
  if((r.direction!=='withdraw'&&!(lg&&r.direction==='charge'))||String(p?.source||'').toLowerCase()==='panda')return [];
  const own=k=>Object.prototype.hasOwnProperty.call(r,k),out=[],text=v=>E(v==null||String(v).trim()===''?'未提供':v);
  const time=(label,key)=>{if(own(key))out.push([label,E(formatTime(r[key],p?.timezone))])};
  const seconds=(label,key)=>{if(own(key))out.push([label,r[key]!=null&&r[key]!==''&&Number.isFinite(Number(r[key]))&&Number(r[key])>=0?N(r[key])+' 秒':'—'])};
  if(own('operator_name'))out.push(['操作人',text(r.operator_name)]);
  if(own('operator_class')||own('processing_method_available'))out.push(['处理方式',r.operator_class==='auto'?'自动':r.operator_class==='manual'?'人工':'未提供']);
  if(own('source_audit_mode'))out.push(['来源审核方式',r.source_audit_mode==='2'?'自动审核':['0','1'].includes(r.source_audit_mode)?'非自动审核':'未提供']);
  time('处理提交时间','processing_submitted_at');time('处理完成时间','processing_completed_at');
  time('审核完成时间','audit_completed_at');time('操作时间（非到账时间）','operated_at');
  seconds('来源处理耗时','processing_duration_seconds');seconds('来源审核耗时','audit_duration_seconds');
  for(const [key,label] of [['automatic_business_note','自动出款业务备注'],['member_business_note','会员业务备注'],
   ['remark_sanitized','业务备注'],['front_note_sanitized','前台业务备注'],['back_note_sanitized','后台业务备注'],
   ['rejection_reason','来源驳回原因'],['interception_reason','来源拦截原因']])if(own(key))out.push([label,text(r[key])]);
  if(lg)for(const [key,label] of [['lg_remark','源备注 remark'],['lg_app_remark','应用备注 appRemark']])if(own(key+'_state')){
   const state=r[key+'_state'];out.push([label,state==='empty'?'源字段为空':state==='redacted'?'隐私内容已隐藏':state==='present'?text(r[key]):'未采集']);
  }
  if(lg&&r.source_business_fields&&typeof r.source_business_fields==='object'&&!Array.isArray(r.source_business_fields)){
   const labels={orderAmount:'订单金额',amount:'来源金额',realAmount:'实际金额',actualAmount:'实际金额',payAmount:'支付金额字段',callbackAmount:'回调金额',feeAmount:'费用金额字段',giveAmount:'赠送金额字段',money:'来源金额',status:'源状态值',createTime:'创建时间',callbackTime:'回调时间',operatorAt:'操作时间',operateAt:'操作时间',operateTime:'操作时间',updateTime:'更新时间',updatedAt:'更新时间',createdAt:'创建时间',created_at:'创建时间',createAt:'创建时间',orderCreateTime:'订单创建时间',orderCreatedAt:'订单创建时间',applyTime:'申请时间',beforeRechargeWithdrawDiff:'前次充提差额字段',currentProfitAmount:'当前利润金额字段',rechargeWithdrawDiff:'充提差额字段',firstFlag:'首次标记',successNo:'成功编号字段',totalOrderNum:'源订单数量',lockType:'锁定类型',appCode:'应用代码',appName:'应用名称',transactionId:'交易号',withdrawBankAppName:'提现银行应用',withdrawChannelName:'提现渠道',withdrawMethodName:'提现方式',withdrawThirdName:'提现三方',withdrawTypeCode:'提现类型代码',withdrawTypeName:'提现类型',rechargeChannelName:'充值渠道',rechargeMethodName:'充值方式',rechargeThirdName:'充值三方',rechargeTypeName:'充值类型',thirdMethodName:'三方方式',operatorName:'源操作人',lockOperatorName:'锁定操作人'};
   for(const [key,label] of Object.entries(labels))if(Object.prototype.hasOwnProperty.call(r.source_business_fields,key)&&['string','number'].includes(typeof r.source_business_fields[key]))out.push([label+'（'+key+'）',text(r.source_business_fields[key])]);
   const groups=r.source_business_fields.groupList;
   if(Array.isArray(groups)&&groups.length<=100)out.push(['会员组（groupList）',groups.length?groups.map(g=>g&&typeof g==='object'?[['groupName','组名'],['groupId','组 ID'],['colorTag','颜色标记']].filter(([k])=>['string','number'].includes(typeof g[k])).map(([k,label])=>E(label+'：'+g[k])).join(' · '):'').join('<br>'):'源字段为空']);
   if(r.source_business_fields.groupListTruncated===true)out.push(['会员组范围','仅展示前100个会员组']);
  }
  return out;
 }
 root.HensemOrderBusiness={rows};
})(window);
