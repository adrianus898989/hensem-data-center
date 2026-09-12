"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ACCOUNT_PERMISSION_MODULES,
  ALL_ACCOUNT_PERMISSIONS,
  buildPermissionPatch,
  canEditPermission,
  createPermissionDraft,
  permissionModuleCount,
  type PermissionItem,
} from "@/lib/accountPermissionCatalog";
import type { DashboardAccountPatch, DashboardProfile } from "@/lib/dashboardAuthClient";
import "./AccountPermissionDialog.css";

type Props = {
  actor: DashboardProfile;
  user: DashboardProfile;
  busy: boolean;
  onSave: (patch: DashboardAccountPatch) => Promise<boolean>;
  onClose: () => void;
  initialModule?: string;
};

type StatusFilter = "all" | "enabled" | "disabled";

function readOnlyLabel(user: DashboardProfile, item: PermissionItem): string {
  if (item.fixed) return "固定开启";
  if (user.role === "owner") return "Owner 固定权限";
  if (user.role === "viewer" && item.kind === "management") return "仅管理员可用";
  return "只读";
}

function PermissionDialogContent({ actor, user, busy, onSave, onClose, initialModule }: Props) {
  const [mounted, setMounted] = useState(false);
  const [baseline] = useState(() => createPermissionDraft(user));
  const [draft, setDraft] = useState<Record<string, boolean>>(() => ({ ...baseline }));
  const [moduleId, setModuleId] = useState(() => (
    ACCOUNT_PERMISSION_MODULES.find((item) => item.id === initialModule)?.id
      || ACCOUNT_PERMISSION_MODULES[0]?.id || ""
  ));
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const helpId = useId();
  const moduleTitleId = useId();
  const searchId = useId();
  const pending = busy || submitting;
  const readOnly = !ALL_ACCOUNT_PERMISSIONS.some((item) => canEditPermission(actor, user, item));
  const changedCount = ALL_ACCOUNT_PERMISSIONS.filter((item) => Boolean(draft[item.id]) !== Boolean(baseline[item.id])).length;
  const overallEnabled = ALL_ACCOUNT_PERMISSIONS.filter((item) => draft[item.id] === true).length;
  const roleName = user.role === "owner" ? "总管理员" : user.role === "admin" ? "管理员" : "查看账号";
  const dirty = changedCount > 0;
  const module = ACCOUNT_PERMISSION_MODULES.find((item) => item.id === moduleId) || ACCOUNT_PERMISSION_MODULES[0];
  const counts = module ? permissionModuleCount(module, draft) : { enabled: 0, total: 0 };
  const patch = useMemo(() => buildPermissionPatch(actor, user, draft), [actor, user, draft]);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (module?.items || []).filter((item) => {
      if (filter === "enabled" && !draft[item.id]) return false;
      if (filter === "disabled" && draft[item.id]) return false;
      return !query || `${item.label} ${item.description} ${item.page} ${item.key}`.toLocaleLowerCase().includes(query);
    });
  }, [module, draft, search, filter]);
  const editableItems = visibleItems.filter((item) => canEditPermission(actor, user, item));
  const pages = useMemo(() => {
    const grouped = new Map<string, PermissionItem[]>();
    for (const item of visibleItems) {
      const entries = grouped.get(item.page) || [];
      entries.push(item);
      grouped.set(item.page, entries);
    }
    return Array.from(grouped.entries());
  }, [visibleItems]);

  const requestClose = useCallback(() => {
    if (pending || savingRef.current) return;
    if (dirty && !window.confirm("有尚未保存的权限修改。确认放弃修改并关闭吗？")) return;
    onClose();
  }, [dirty, pending, onClose]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (scrollbarWidth) {
      const existingPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${existingPadding + scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    (closeButtonRef.current?.disabled ? dialogRef.current : closeButtonRef.current)?.focus({ preventScroll: true });

    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ) || []).filter((element) => !element.hidden && element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      if (!dialogRef.current?.contains(focused) || focused === dialogRef.current
        || (event.shiftKey && focused === first) || (!event.shiftKey && focused === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) {
        (focusable()[0] || dialogRef.current)?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [mounted]);

  function chooseModule(id: string) {
    setModuleId(id);
    setSearch("");
    setFilter("all");
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }

  function setPermission(item: PermissionItem, enabled: boolean) {
    if (pending || !canEditPermission(actor, user, item)) return;
    setDraft((current) => ({ ...current, [item.id]: enabled }));
    setError("");
  }

  function setVisible(enabled: boolean) {
    if (pending) return;
    setDraft((current) => {
      const next = { ...current };
      for (const item of editableItems) next[item.id] = enabled;
      return next;
    });
    setError("");
  }

  async function save() {
    if (pending || savingRef.current || !dirty) return;
    const currentPatch = buildPermissionPatch(actor, user, draft);
    if (!currentPatch) {
      setError("当前没有可以保存的权限修改，请确认你有该账号的管理权限。");
      return;
    }
    savingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (await onSave(currentPatch)) onClose();
      else setError("保存未成功，修改已保留。请检查权限或稍后重试。");
    } catch {
      setError("保存未成功，修改已保留。请检查网络或稍后重试。");
    } finally {
      savingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!mounted) return null;
  return createPortal(
    <div className="account-permission-overlay" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={dialogRef} className="account-permission-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId} aria-busy={pending} tabIndex={-1}>
        <header className="account-permission-header">
          <div>
            <div className="account-permission-eyebrow">账号权限配置</div>
            <h2 id={titleId}>设置权限 <span>{user.username}</span><span className="account-permission-role">{roleName}</span></h2>
            <p id={helpId}>{readOnly ? "只读查看此账号的功能授权，不会修改权限。" : "只调整此账号的功能授权，角色、启用状态与 IP 设置保持不变。"}</p>
          </div>
          <div className="account-permission-header-tools">
            <div className="account-permission-overall" aria-live="polite"><span>整体已开启</span><strong>{overallEnabled}<small> / {ALL_ACCOUNT_PERMISSIONS.length}</small></strong>{user.role === "owner" && <span>只读</span>}</div>
            <button ref={closeButtonRef} type="button" className="account-permission-close" onClick={requestClose} disabled={pending} aria-label="关闭权限设置">×</button>
          </div>
        </header>

        <div className="account-permission-layout">
          <nav className="account-permission-nav" aria-label="权限模块">
            <div className="account-permission-nav-caption">权限模块 <span>已开启 / 全部</span></div>
            {ACCOUNT_PERMISSION_MODULES.map((entry) => {
              const count = permissionModuleCount(entry, draft);
              return <button type="button" key={entry.id} className={`account-permission-module${entry.id === module?.id ? " is-selected" : ""}`} aria-current={entry.id === module?.id ? "true" : undefined} onClick={() => chooseModule(entry.id)}>
                <span>{entry.label}</span><span className="account-permission-module-count">{count.enabled}/{count.total}</span>
              </button>;
            })}
            <p className="account-permission-nav-note">切换模块不会丢失未保存的修改</p>
          </nav>

          <section className="account-permission-main" aria-labelledby={moduleTitleId}>
            <div className="account-permission-toolbar">
              <div className="account-permission-module-heading"><h3 id={moduleTitleId}>{module?.label || "权限"}</h3><span>已开启 {counts.enabled} / {counts.total}</span></div>
              <p>{module?.description}</p>
              <div className="account-permission-filter-row">
                <div className="account-permission-filters" role="group" aria-label="按权限状态筛选">
                  {([
                    ["all", "全部", counts.total],
                    ["enabled", "已开", counts.enabled],
                    ["disabled", "未开", counts.total - counts.enabled],
                  ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? "is-selected" : ""} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}
                </div>
                <div className="account-permission-search">
                  <label htmlFor={searchId} className="account-permission-sr-only">搜索当前模块的权限</label>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
                  <input id={searchId} type="search" placeholder="搜索权限名称 / 标识" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
              </div>
              <div className="account-permission-batch-row">
                <span aria-live="polite">当前结果 {visibleItems.length} 项<span className="account-permission-batch-editable"> · 可编辑 {editableItems.length} 项</span></span>
                <div><button type="button" disabled={pending || !editableItems.some((item) => !draft[item.id])} onClick={() => setVisible(true)}>勾选当前结果</button><button type="button" disabled={pending || !editableItems.some((item) => draft[item.id])} onClick={() => setVisible(false)}>取消当前结果</button></div>
              </div>
            </div>

            <div className="account-permission-content" ref={contentRef}>
              {user.role === "owner" && <p className="account-permission-readonly-notice">Owner 固定拥有全部权限，此处仅供查看。</p>}
              {pages.map(([page, items]) => <section className="account-permission-page" key={page}>
                <div className="account-permission-page-heading"><h4>{page}</h4><span>{items.length} 项权限</span></div>
                <div className="account-permission-cards">
                  {items.map((item) => {
                    const editable = canEditPermission(actor, user, item);
                    const enabled = Boolean(draft[item.id]);
                    return <label className={`account-permission-card${enabled ? " is-enabled" : ""}${!editable ? " is-readonly" : ""}`} key={item.id}>
                      <input type="checkbox" checked={enabled} disabled={pending || !editable} onChange={(event) => setPermission(item, event.target.checked)} />
                      <span className="account-permission-card-body">
                        <span className="account-permission-card-title"><span>{item.label}</span>{item.sensitive && <span className="account-permission-sensitive">管理权限</span>}</span>
                        <span className="account-permission-card-description">{item.description}</span>
                        <code>{item.key}</code>
                      </span>
                      <span className={`account-permission-card-state${!editable ? " is-locked" : ""}`}>{!editable ? readOnlyLabel(user, item) : enabled ? "已开启" : "未开启"}</span>
                    </label>;
                  })}
                </div>
              </section>)}
              {!visibleItems.length && <div className="account-permission-empty"><strong>没有符合条件的权限</strong><p>试试其他关键词或切换为“全部”。</p><button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>清除筛选</button></div>}
            </div>
          </section>
        </div>

        <footer className="account-permission-footer">
          <div className="account-permission-footer-copy">
            {error ? <p className="account-permission-error" role="alert">{error}</p> : <p aria-live="polite">{readOnly ? "只读查看，不会修改授权" : dirty ? `已修改 ${changedCount} 项权限，尚未保存` : "仅配置权限，不修改账号角色或启用状态"}</p>}
          </div>
          <div className="account-permission-footer-actions">{readOnly ? <button type="button" className="account-permission-save account-permission-done" disabled={pending} onClick={requestClose}>完成</button> : <><button type="button" className="account-permission-cancel" disabled={pending} onClick={requestClose}>{dirty ? "取消" : "关闭"}</button><button type="button" className="account-permission-save" disabled={pending || !dirty || !patch} onClick={() => void save()}>{pending ? "保存中…" : "保存权限"}</button></>}</div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export default function AccountPermissionDialog(props: Props) {
  return <PermissionDialogContent key={props.user.auth_user_id} {...props} />;
}
