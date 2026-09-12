import {
  normalizedManagementPermissions,
  normalizedPermissions,
  type DashboardAccountPatch,
  type DashboardManagementPermissions,
  type DashboardPermissionKey,
  type DashboardProfile,
} from "@/lib/dashboardAuthClient";
import { effectiveDashboardDataScope, isDashboardDataScopeSubset, normalizeDashboardDataScope } from "./dashboardDataScope";

export type PermissionItem = {
  id: string;
  label: string;
  description: string;
  page: string;
  sensitive?: boolean;
  fixed?: boolean;
} & (
  | { kind: "business"; key: DashboardPermissionKey }
  | { kind: "management"; key: keyof DashboardManagementPermissions }
);

export type PermissionModule = {
  id: string;
  label: string;
  description: string;
  items: readonly PermissionItem[];
};

export const ACCOUNT_PERMISSION_MODULES: readonly PermissionModule[] = [
  {
    id: "home", label: "首页", description: "首页与模块入口，所有账号固定可用。",
    items: [{ id: "home", key: "home", kind: "business", label: "首页 / 选择模块",
      description: "查看已获授权的模块入口；不能关闭首页。", page: "首页 / 选择模块", fixed: true }],
  },
  {
    id: "third_party", label: "三方量 / 费率", description: "三方量、费率与盘口状态。",
    items: [{ id: "third_party", key: "third_party", kind: "business", label: "三方量 / 费率",
      description: "查看三方量、费率与盘口状态。", page: "三方量 / 费率" }],
  },
  {
    id: "auto_withdraw", label: "提现 / 自动出款", description: "自动出款与提现操作人统计。",
    items: [{ id: "auto_withdraw", key: "auto_withdraw", kind: "business", label: "提现 / 自动出款",
      description: "查看自动出款与提现操作人统计。", page: "提现 / 自动出款" }],
  },
  {
    id: "work_customer", label: "工单 / 客服", description: "工单与客服分别授权，不会互相联动。",
    items: [
      { id: "work_orders", key: "work_orders", kind: "business", label: "工单",
        description: "控制工单业务权限，与客服权限独立。", page: "工单 / 客服" },
      { id: "customer_service", key: "customer_service", kind: "business", label: "客服",
        description: "控制客服业务权限，与工单权限独立。", page: "工单 / 客服" },
    ],
  },
  {
    id: "management", label: "管理后台", description: "仅总管理员可以调整管理员的后台权限。",
    items: [
      { id: "manage_viewers", key: "manage_viewers", kind: "management", label: "账号管理",
        description: "建立、停用、删除查看账号，以及重置查看账号密码。", page: "管理后台 / 账号与权限", sensitive: true },
      { id: "refresh_data", key: "refresh_data", kind: "management", label: "数据刷新",
        description: "手动刷新今日、昨日、费率与历史补齐数据。", page: "管理后台 / 数据同步", sensitive: true },
      { id: "view_audit", key: "view_audit", kind: "management", label: "操作记录",
        description: "查看后台管理操作日志。", page: "管理后台 / 操作记录" },
    ],
  },
];

export const ALL_ACCOUNT_PERMISSIONS: readonly PermissionItem[] = ACCOUNT_PERMISSION_MODULES.flatMap((module) => module.items);

export function createPermissionDraft(user: DashboardProfile): Record<string, boolean> {
  const business = normalizedPermissions(user);
  const management = normalizedManagementPermissions(user);
  return Object.fromEntries(ALL_ACCOUNT_PERMISSIONS.map((item) => [
    item.id, item.kind === "business" ? business[item.key] : management[item.key],
  ]));
}

// This is a UI guard only. The existing server remains the authorization authority.
export function canEditPermission(
  actor: DashboardProfile | null | undefined,
  target: DashboardProfile,
  item: PermissionItem,
): boolean {
  const known = ALL_ACCOUNT_PERMISSIONS.find((entry) => entry.id === item.id
    && entry.key === item.key && entry.kind === item.kind);
  if (!actor || actor.active !== true || !known || known.fixed || target.role === "owner") return false;
  if (target.role !== "admin" && target.role !== "viewer") return false;
  if (!isDashboardDataScopeSubset(normalizeDashboardDataScope(target.data_scope), effectiveDashboardDataScope(actor))) return false;
  if (known.kind === "management") return actor.role === "owner" && target.role === "admin";
  if (actor.role === "owner") return true;
  return actor.role === "admin" && target.role === "viewer"
    && normalizedManagementPermissions(actor).manage_viewers;
}

export function buildPermissionPatch(
  actor: DashboardProfile | null | undefined,
  target: DashboardProfile,
  draft: Record<string, boolean>,
): DashboardAccountPatch | null {
  const current = createPermissionDraft(target);
  const patch: DashboardAccountPatch = {};
  for (const item of ALL_ACCOUNT_PERMISSIONS) {
    if (!Object.prototype.hasOwnProperty.call(draft, item.id) || typeof draft[item.id] !== "boolean"
      || draft[item.id] === current[item.id] || !canEditPermission(actor, target, item)) continue;
    // The existing endpoint replaces each submitted permission object. Send no
    // unchanged branch (and no patch at all for a no-op); once a branch changes,
    // include its normalized keys so sparse admin defaults are not switched off.
    // Retain any other existing properties; never submit role or active here.
    if (item.kind === "business") {
      patch.permissions ??= { ...target.permissions, ...normalizedPermissions(target) };
      patch.permissions[item.key] = draft[item.id];
    } else {
      patch.management_permissions ??= { ...target.management_permissions, ...normalizedManagementPermissions(target) };
      patch.management_permissions[item.key] = draft[item.id];
    }
  }
  return Object.keys(patch).length ? patch : null;
}

export function permissionModuleCount(module: PermissionModule, draft: Record<string, boolean>): { enabled: number; total: number } {
  return {
    enabled: module.items.filter((item) => item.fixed || draft[item.id] === true).length,
    total: module.items.length,
  };
}
