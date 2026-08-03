# Hensem 数据后台 V253 — 精简部署包

这个目录已经把旧版部署说明、已完成 SQL、重复文件、tsbuild 缓存等从根目录清掉。

## 根目录
只保留 Netlify / Next.js 构建需要的文件：
- src/
- netlify/
- package.json
- pnpm-lock.yaml
- netlify.toml
- next.config.mjs
- tsconfig.json
- .env.example / .npmrc / .gitignore

## BACKEND_CURRENT
当前仍需要保留的后端源码都集中在这里：
- dashboard-user-admin.ts
- sync-auto-withdraw-raw.ts
- bright-responder.ts
- 34_自动出款_最新数据每10分钟同步.sql

## 已从精简包删除
这些文件不影响现在网站运行，所以不再放在部署根目录：
- DEPLOY_V242 ~ DEPLOY_V252 等旧部署说明
- 已执行完成的旧 SQL（21、22 等）
- README_V100_UNIFIED.md
- CHANGELOG.md
- package-lock.json（当前使用 pnpm）
- tsconfig.tsbuildinfo
- 根目录重复的 Edge Function / SQL 文件

注意：
删除的是“部署包里的副本”，不会删除你 Supabase 已执行的 SQL、数据库表、Cron 或 Edge Function。
