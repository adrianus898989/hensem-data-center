import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hensem Data Center",
  description: "Hensem Control Center · Secure Data Dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
