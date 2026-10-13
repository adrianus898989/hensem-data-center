export type WorkOrderBaseRole = "supervisor" | "agent" | "auditor";
export type WorkOrderPermissionMap = Record<string, boolean>;
export const workOrderRoleLabels: Record<WorkOrderBaseRole, string> = {supervisor:"主管",agent:"员工",auditor:"审计员"};
const allRoles:WorkOrderBaseRole[]=["agent","supervisor","auditor"],writers:WorkOrderBaseRole[]=["agent","supervisor"],supervisors:WorkOrderBaseRole[]=["supervisor"];
export const workOrderPermissionCatalog = [
 {key:"case.view",label:"查看登记与跟进",group:"工单处理",roles:allRoles},
 {key:"case.view_team",label:"查看团队工单",group:"工单处理",roles:["supervisor","auditor"] as WorkOrderBaseRole[]},
 {key:"case.create",label:"新增登记",group:"工单处理",roles:writers},
 {key:"case.follow",label:"保存跟进",group:"工单处理",roles:writers},
 {key:"case.close",label:"关闭工单",group:"工单处理",roles:writers},
 {key:"case.approve",label:"审批工单",group:"工单处理",roles:supervisors},
 {key:"case.reopen",label:"重新打开工单",group:"工单处理",roles:supervisors},
 {key:"case.link",label:"关联工单",group:"工单处理",roles:writers},
 {key:"case.assign",label:"分配工单",group:"工单处理",roles:supervisors},
 {key:"proof.read",label:"查看凭证",group:"凭证",roles:allRoles},
 {key:"proof.upload",label:"上传凭证",group:"凭证",roles:writers},
 {key:"proof.remove",label:"移除凭证",group:"凭证",roles:writers},
 {key:"report.view",label:"查看报表",group:"查询与审计",roles:["supervisor","auditor"] as WorkOrderBaseRole[]},
 {key:"activity.view",label:"查看活动记录",group:"查询与审计",roles:["supervisor","auditor"] as WorkOrderBaseRole[]},
 {key:"audit.view",label:"查看审计记录",group:"查询与审计",roles:["supervisor","auditor"] as WorkOrderBaseRole[]},
 {key:"provider_upis.view",label:"查看 UPI 目录与检查结果",group:"三方 UPI",roles:allRoles},
 {key:"provider_upis.add",label:"新增 UPI",group:"三方 UPI",roles:writers},
] as const;
export function emptyWorkOrderPermissions():WorkOrderPermissionMap {return {"provider_upis.view":false,"provider_upis.add":false};}
export function workOrderPermissionsForBase(permissions:WorkOrderPermissionMap,role:WorkOrderBaseRole):WorkOrderPermissionMap {return Object.fromEntries(Object.entries(permissions).map(([key,value])=>{const item=workOrderPermissionCatalog.find(item=>item.key===key);return [key,!!item&&item.roles.includes(role)&&value===true];}));}
export function changeWorkOrderPermission(permissions:WorkOrderPermissionMap,role:WorkOrderBaseRole,key:string,checked:boolean):WorkOrderPermissionMap {
 const item=workOrderPermissionCatalog.find(item=>item.key===key);if(!item||!key.startsWith("provider_upis.")||!item.roles.includes(role))return {...permissions};
 const next={...permissions,[key]:checked};if(key==="provider_upis.add"&&checked)next["provider_upis.view"]=true;if(key==="provider_upis.view"&&!checked)next["provider_upis.add"]=false;return workOrderPermissionsForBase(next,role);
}
