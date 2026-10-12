/* Shared, allowlisted business fields for every single-order drawer. */
(function(root){
 'use strict';
 function rows(r,p,{E,N,formatTime}){
  if(r.direction!=='withdraw'||String(p?.source||'').toLowerCase()==='panda')return [];
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
  return out;
 }
 root.HensemOrderBusiness={rows};
})(window);
