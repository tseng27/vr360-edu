import type { NextConfig } from "next";

// STATIC_EXPORT=1 時輸出純靜態檔到 out/（GitHub Pages 用）；平常（本機、Vercel）維持一般 Next.js。
// NEXT_PUBLIC_BASE_PATH：部署在子路徑時，例如 GitHub Pages 的 /vr360-edu
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const isExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isExport ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
