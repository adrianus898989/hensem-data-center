import type { Metadata } from "next";
import "./globals.css";
import { dashboardEntryRecoveryScript } from "@/lib/dashboardEntryRecovery";

export const metadata: Metadata = {
  title: "M8 | 数据中控后台",
  description: "M8 | 数据中控后台 · Secure Data Dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: dashboardEntryRecoveryScript }} />
        <style>{`
          [data-entry-recovery] { display: none; }
          html[data-entry-state] [data-entry-check="pending"] [data-entry-message] { display: none; }
          html[data-entry-state] [data-entry-check="pending"] [data-entry-recovery] { display: block; }
          [data-entry-recovery] span { display: none; }
          html[data-entry-state="slow"] [data-entry-slow],
          html[data-entry-state="failed"] [data-entry-failed],
          html[data-entry-state="offline"] [data-entry-offline] { display: inline; }
          [data-entry-retry] { margin-inline-start: .75rem; padding: .4rem .7rem; cursor: pointer; }
        `}</style>
      </head>
      <body><noscript>请启用 JavaScript 后重新加载后台。</noscript>{children}</body>
    </html>
  );
}
