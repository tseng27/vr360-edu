/**
 * 教室模組設定。全部來自 NEXT_PUBLIC_* 環境變數（會打包進前端，所以只能放公開值）。
 *
 * NEXT_PUBLIC_CLASSROOM_ENABLED   "false" 時整個 /classroom 模組關閉（預設開啟）
 * NEXT_PUBLIC_CLASSROOM_BACKEND   "mock"（預設，同一台電腦多視窗測試）或 "supabase"
 * NEXT_PUBLIC_SUPABASE_URL        https://<project>.supabase.co
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  sb_publishable_…（或舊版 anon key）
 * NEXT_PUBLIC_BASE_PATH           部署在子路徑時（例如 GitHub Pages 的 /vr360-edu）
 */

export type BackendKind = "mock" | "supabase";

export interface ClassroomConfig {
  enabled: boolean;
  backend: BackendKind;
  supabaseUrl?: string;
  supabaseKey?: string;
  basePath: string;
  /** 設定有問題時的說明（例如把 secret key 放進前端） */
  error?: string;
}

/** 判斷一把 key 是否其實是不能出現在前端的 secret / service_role key */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return json?.role === "service_role";
    } catch {
      return false;
    }
  }
  return false;
}

export function readConfig(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_CLASSROOM_ENABLED: process.env.NEXT_PUBLIC_CLASSROOM_ENABLED,
  NEXT_PUBLIC_CLASSROOM_BACKEND: process.env.NEXT_PUBLIC_CLASSROOM_BACKEND,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
}): ClassroomConfig {
  const enabled = env.NEXT_PUBLIC_CLASSROOM_ENABLED !== "false";
  const backend: BackendKind = env.NEXT_PUBLIC_CLASSROOM_BACKEND === "supabase" ? "supabase" : "mock";
  const basePath = (env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  const cfg: ClassroomConfig = { enabled, backend, basePath };
  if (backend === "supabase") {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) cfg.error = "已選擇 Supabase 後端，但缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。";
    else if (!/^https:\/\//.test(url)) cfg.error = "NEXT_PUBLIC_SUPABASE_URL 必須是 https 網址。";
    else if (looksLikeSecretKey(key))
      cfg.error = "偵測到 secret / service_role key 被放進前端設定，已停止連線。請改用 publishable key，並立刻到 Supabase 後台輪替這把 secret key。";
    else {
      cfg.supabaseUrl = url.replace(/\/$/, "");
      cfg.supabaseKey = key;
    }
  }
  return cfg;
}

export const config = readConfig();

/** 靜態檔路徑加上 basePath */
export function asset(path: string): string {
  return path.startsWith("/") ? `${config.basePath}${path}` : path;
}
