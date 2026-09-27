export const PERMISSION_LABELS: Record<string,string> = {
  "case.view": "查看本人负责的工单",
  "case.view_team": "查看授权范围内团队工单",
  "case.create": "新增工单登记",
  "case.follow": "编辑与跟进工单",
  "case.close": "登记到账或退款并关闭",
  "case.approve": "审核关闭工单",
  "case.reopen": "重新打开已关闭工单",
  "case.link": "关联同订单的其他工单",
  "case.assign": "分配工单负责人",
  "proof.read": "查看工单图片",
  "proof.upload": "上传工单图片",
  "proof.remove": "移除本人未关联图片",
  "report.view": "查看核对与登记报表",
  "activity.view": "查看员工工作量",
  "audit.view": "查看范围内操作日志"
};
export const PERMISSION_DEFAULTS: Record<string,Record<string,boolean>> = {
  "agent": {
    "case.view": true,
    "case.view_team": false,
    "case.create": true,
    "case.follow": true,
    "case.close": true,
    "case.approve": false,
    "case.reopen": false,
    "case.link": true,
    "case.assign": false,
    "proof.read": true,
    "proof.upload": true,
    "proof.remove": true,
    "report.view": false,
    "activity.view": false,
    "audit.view": false
  },
  "supervisor": {
    "case.view": true,
    "case.view_team": true,
    "case.create": true,
    "case.follow": true,
    "case.close": true,
    "case.approve": true,
    "case.reopen": true,
    "case.link": true,
    "case.assign": true,
    "proof.read": true,
    "proof.upload": true,
    "proof.remove": true,
    "report.view": true,
    "activity.view": true,
    "audit.view": true
  },
  "auditor": {
    "case.view": true,
    "case.view_team": true,
    "case.create": false,
    "case.follow": false,
    "case.close": false,
    "case.approve": false,
    "case.reopen": false,
    "case.link": false,
    "case.assign": false,
    "proof.read": true,
    "proof.upload": false,
    "proof.remove": false,
    "report.view": true,
    "activity.view": true,
    "audit.view": true
  }
};
export function permissionMap(role: string, value: unknown): Record<string,boolean> {
 const ceiling=PERMISSION_DEFAULTS[role] || {};
 if (value == null) return {...ceiling};
 if (typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key,enabled]) => !(key in PERMISSION_LABELS) || typeof enabled !== 'boolean')) throw Error('invalid_permissions');
 return Object.fromEntries(Object.keys(PERMISSION_LABELS).map(key=>[key, ceiling[key]===true && (value as Record<string,unknown>)[key]===true]));
}
export function validatePermissionMap(role:string, value:unknown):Record<string,boolean> {
 const result=permissionMap(role,value);
 if(value && Object.entries(value as Record<string,unknown>).some(([key,enabled])=>enabled===true && result[key]!==true)) throw Error('role_permission_exceeded');
 return result;
}
