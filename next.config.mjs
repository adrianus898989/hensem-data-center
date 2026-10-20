import { fileURLToPath } from "node:url";
import { writeDashboardRelease } from "./scripts/dashboard-release.mjs";

const basePath = process.env.PAGES_BASE_PATH || "";
const dashboardRelease = writeDashboardRelease(fileURLToPath(new URL(".", import.meta.url)));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  env: {
    NEXT_PUBLIC_DASHBOARD_RELEASE: dashboardRelease,
    NEXT_PUBLIC_DASHBOARD_BASE_PATH: basePath
  },
  reactStrictMode: true,
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true
  }
};

export default nextConfig;
