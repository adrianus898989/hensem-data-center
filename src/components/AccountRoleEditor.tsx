"use client";

import { useState } from "react";
import type { DashboardAccountPatch, DashboardManagementPermissions, DashboardProfile } from "@/lib/dashboardAuthClient";

const MANAGEMENT_CHOICES: Array<{ key: keyof DashboardManagementPermissions; label: string }> = [
  { key: "manage_viewers", label: "账号管理" },
  { key: "refresh_data", label: "数据刷新" },
  { key: "view_audit", label: "操作记录" },
];

export default function AccountRoleEditor({ user, busy, onSave }: {
  user: DashboardProfile;
  busy: boolean;
  onSave: (patch: DashboardAccountPatch) => Promise<boolean>;
}) {
  const [role, setRole] = useState<"admin" | "viewer">(user.role === "admin" ? "admin" : "viewer");
  const [management, setManagement] = useState<DashboardManagementPermissions>({
    manage_viewers: false, refresh_data: false, view_audit: false,
  });
  if (user.role === "owner") return null;
  const changed = role !== user.role;
  const title = role === "admin" ? "管理员" : "查看账号";
  async function save() {
    if (busy || !changed) return;
    const enabled = MANAGEMENT_CHOICES.filter((item) => management[item.key]).map((item) => item.label);
    const detail = role === "admin"
      ? `后台权限：${enabled.join("、") || "未选择（不能进入管理后台）"}。`
      : "后台管理权限将全部移除。";
    if (!window.confirm(`将 ${user.username} 改为${title}？\n${detail}\n业务模块和启用状态保持不变。`)) return;
    await onSave({
      role, expected_role: user.role as "admin" | "viewer",
      ...(role === "admin" ? { management_permissions: management } : {}),
    });
  }
  return <div className="admin-account-role-editor">
    <div className="admin-account-role-controls">
      <label htmlFor={`account-role-${user.auth_user_id}`}>账号角色</label>
      <select id={`account-role-${user.auth_user_id}`} value={role} disabled={busy} onChange={(event) => setRole(event.target.value as "admin" | "viewer")}>
        <option value="viewer">查看账号</option><option value="admin">管理员</option>
      </select>
      <button type="button" disabled={busy || !changed} onClick={() => void save()}>{busy ? "保存中…" : "保存角色"}</button>
      {changed && <button type="button" disabled={busy} onClick={() => { setRole(user.role as "admin" | "viewer"); setManagement({ manage_viewers: false, refresh_data: false, view_audit: false }); }}>取消</button>}
    </div>
    {changed && role === "admin" && <fieldset disabled={busy} className="admin-role-management">
      <legend>选择该管理员可用的后台权限</legend>
      {MANAGEMENT_CHOICES.map((item) => <label key={item.key}><input type="checkbox" checked={management[item.key]} onChange={(event) => setManagement({ ...management, [item.key]: event.target.checked })} />{item.label}</label>)}
    </fieldset>}
    {changed && role === "viewer" && <p className="admin-role-warning">保存后移除后台管理权限，保留现有业务模块。</p>}
  </div>;
}
