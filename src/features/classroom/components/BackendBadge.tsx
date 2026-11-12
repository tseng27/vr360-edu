"use client";
import { config } from "../config";

export default function BackendBadge({ className = "" }: { className?: string }) {
  return config.backend === "mock" ? (
    <span className={`rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 ${className}`} title="同一台電腦、同一個瀏覽器的多個視窗之間同步">
      Mock 模式：只在同一台電腦的瀏覽器視窗間同步
    </span>
  ) : (
    <span className={`rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900 ${className}`}>雲端同步（Supabase）</span>
  );
}
