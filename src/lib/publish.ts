"use client";
/**
 * 「發布到網路」：學生用 Google 帳號登入，把本機（IndexedDB）的導覽上傳到 Supabase，
 * 產生任何裝置（手機、平板、VR 頭盔）都能開的公開網址 /view?pub=<id>。
 *
 * 需要環境變數 NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY，
 * 以及 supabase/migrations/20261123000000_published_tours.sql。沒設定時按鈕會說明改用「匯出專案檔」。
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { looksLikeSecretKey } from "@/features/classroom/config";
import { getBlob } from "./store";
import type { Project } from "./types";

const BUCKET = "vr360-media";
const TABLE = "vr360_published";

function readCloud(): { url: string; key: string } | { error: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!/^https:\/\//.test(url)) return { error: "NEXT_PUBLIC_SUPABASE_URL 必須是 https 網址" };
  if (looksLikeSecretKey(key)) return { error: "前端設定放了 secret key，已停止連線。請改用 publishable key 並輪替 secret key。" };
  return { url, key };
}

const cloud = readCloud();

/** null = 沒設定雲端；{error} = 設定錯誤 */
export const cloudStatus: "ready" | "off" | string =
  cloud === null ? "off" : "error" in cloud ? cloud.error : "ready";

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!cloud || "error" in cloud) throw new Error("尚未設定雲端（Supabase）");
  client ??= createClient(cloud.url, cloud.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "vr360-auth" },
  });
  return client;
}

export function publicMediaUrl(path: string): string {
  if (!cloud || "error" in cloud) return path;
  return `${cloud.url}/storage/v1/object/public/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function currentUser(): Promise<User | null> {
  const { data } = await sb().auth.getSession();
  return data.session?.user ?? null;
}

export function onAuthChange(fn: (u: User | null) => void): () => void {
  const { data } = sb().auth.onAuthStateChange((_e, s) => fn(s?.user ?? null));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(returnTo = location.href) {
  const { error } = await sb().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: returnTo, queryParams: { prompt: "select_account" } },
  });
  if (error) throw new Error("無法開啟 Google 登入：" + error.message);
}

export async function signOut() {
  await sb().auth.signOut();
}

export interface PublishedData {
  project: Project;
  /** blobKey → Storage 路徑 */
  media: Record<string, string>;
}

function mediaKeys(p: Project): string[] {
  const ks = new Set<string>();
  for (const s of p.scenes) {
    ks.add(s.imageKey);
    ks.add(s.thumbKey);
    for (const h of s.hotspots) if (h.imageKey) ks.add(h.imageKey);
  }
  return [...ks];
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * 上傳圖片並建立 / 更新公開導覽。回傳 publishedId（第一次發布時新產生，呼叫端要存回專案）。
 * 圖片 key 一旦建立內容就不會變，所以已上傳過的檔案直接略過。
 */
export async function publishProject(p: Project, onProgress?: (done: number, total: number) => void): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("請先用 Google 登入");
  if (!p.scenes.length) throw new Error("專案還沒有場景");
  const pubId = p.publishedId ?? nanoid(12);
  const keys = mediaKeys(p);
  const media: Record<string, string> = {};
  let done = 0;
  for (const k of keys) {
    const blob = await getBlob(k);
    if (!blob) throw new Error("有圖片在這台電腦上找不到，請重新上傳該場景");
    const type = EXT[blob.type] ? blob.type : "image/jpeg";
    const path = `${user.id}/${pubId}/${k}.${EXT[type]}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
    if (error && !/exist|duplicate/i.test(error.message)) throw new Error("圖片上傳失敗：" + error.message);
    media[k] = path;
    onProgress?.(++done, keys.length);
  }
  const project: Project = { ...p, publishedId: pubId };
  const row = {
    id: pubId,
    title: (p.title || "未命名導覽").slice(0, 80),
    author: (p.author || "").slice(0, 60),
    type: p.type,
    data: { project, media } satisfies PublishedData,
  };
  const { error } = await sb().from(TABLE).upsert(row);
  if (error) {
    if (/quota/.test(error.message + (error.hint ?? ""))) throw new Error("已發布的導覽太多了（上限 50 個），請先取消發布舊的");
    throw new Error("發布失敗：" + error.message);
  }
  return pubId;
}

export async function unpublishProject(pubId: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("請先用 Google 登入");
  const { error } = await sb().from(TABLE).delete().eq("id", pubId);
  if (error) throw new Error("取消發布失敗：" + error.message);
  const folder = `${user.id}/${pubId}`;
  const { data } = await sb().storage.from(BUCKET).list(folder, { limit: 1000 });
  if (data?.length) await sb().storage.from(BUCKET).remove(data.map((f) => `${folder}/${f.name}`));
}

export async function loadPublished(pubId: string): Promise<PublishedData | null> {
  const { data, error } = await sb().from(TABLE).select("data").eq("id", pubId).maybeSingle();
  if (error) throw new Error("讀取失敗：" + error.message);
  return (data?.data as PublishedData | undefined) ?? null;
}

/** 分享網址（含 basePath，例如 GitHub Pages 的 /vr360-edu） */
export function shareUrl(pubId: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  return `${location.origin}${base}/view/?pub=${encodeURIComponent(pubId)}`;
}
