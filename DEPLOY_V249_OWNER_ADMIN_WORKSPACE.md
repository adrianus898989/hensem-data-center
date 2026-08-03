# V249 部署：总管理员 / 小管理员 / Viewer + 独立管理后台

本版只改账号权限与管理后台 UI，不修改三方量业务规则、Google→Supabase Cron、费率逻辑。

## 权限层级

- Owner / 总管理员：唯一最高权限。只有 Owner 可以建立、修改、删除小管理员。
- Admin / 小管理员：由 Owner 分配后台权限；可以选择是否允许管理 Viewer、手动刷新数据、查看操作记录。
- Viewer / 查看账号：只有业务模块查看权限，不能管理账号、刷新数据或查看后台操作记录。

## UI

管理后台不再使用居中的弹窗。点击左侧「系统管理 → 管理后台」或右上角账号菜单后，会进入独立全页管理工作区；左侧固定显示管理导航。

## 部署顺序

1. Supabase SQL Editor 执行 `supabase/dashboard-owner-admin-upgrade.sql`。
   - 当前 `admin` 自动升级成唯一 Owner。
   - 最后结果应看到 `admin | owner | true`。
2. Supabase Edge Functions → `dashboard-user-admin` → Code。
   - 用 `supabase/dashboard-user-admin.ts` 全部覆盖。
   - Deploy updates。
   - Verify JWT with legacy secret 继续 OFF。
3. 把整个 V249 项目覆盖 GitHub `hensem-data-center` → Commit main → Netlify 自动部署。
4. 强制刷新网站（Mac：Command + Shift + R）。

## 不需要改

- bright-responder 不动。
- 08~18 的 Cron / SQL 不动。
- Netlify 环境变量不动。
