import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "M8 | 数据中控后台",
  description: "M8 | 数据中控后台 · Secure Data Dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
