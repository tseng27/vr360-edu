"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { User } from "@supabase/supabase-js";
import {
  cloudStatus,
  currentUser,
  onAuthChange,
  publishProject,
  shareUrl,
  signInWithGoogle,
  signOut,
  unpublishProject,
} from "@/lib/publish";
import type { Project } from "@/lib/types";

interface Props {
  project: Project;
  /** 發布 / 取消發布後把 publishedId 存回本機專案 */
  onChange(patch: Pick<Project, "publishedId" | "publishedAt">): void;
  onClose(): void;
}

export default function PublishDialog({ project, onChange, onClose }: Props) {
  const ready = cloudStatus === "ready";
  const [user, setUser] = useState<User | null | undefined>(ready ? undefined : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const url = project.publishedId ? shareUrl(project.publishedId) : null;

  useEffect(() => {
    if (!ready) return;
    currentUser().then(setUser);
    return onAuthChange(setUser);
  }, [ready]);

  useEffect(() => {
    if (url) QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setQr);
    else setQr(undefined);
  }, [url]);

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const publish = () =>
    run("上傳中…", async () => {
      const id = await publishProject(project, (d, t) => setBusy(`上傳圖片 ${d}/${t}…`));
      onChange({ publishedId: id, publishedAt: Date.now() });
    });

  const unpublish = () => {
    if (!project.publishedId || !confirm("取消發布後，原本的連結就打不開了。確定嗎？")) return;
    run("取消發布中…", async () => {
      await unpublishProject(project.publishedId!);
      onChange({ publishedId: undefined, publishedAt: undefined });
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="發布到網路"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 text-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">發布到網路</h2>
          <button onClick={onClose} className="text-sm text-slate-500">關閉</button>
        </div>

        {!ready ? (
          <div className="space-y-3 text-sm">
            <p>這個網站還沒有連上雲端資料庫，所以暫時不能發布。</p>
            {cloudStatus !== "off" && <p className="rounded bg-rose-50 p-2 text-rose-700">{cloudStatus}</p>}
            <p className="text-slate-600">
              請老師依照 README 的「發布功能設定」完成 Supabase 設定。在那之前，可以先用「匯出專案檔」把導覽交給老師。
            </p>
          </div>
        ) : user === undefined ? (
          <p className="text-sm text-slate-500">確認登入狀態…</p>
        ) : user === null ? (
          <div className="space-y-3 text-sm">
            <p>發布後會得到一個網址和 QR Code，同學用手機、平板或 VR 頭盔打開就能看你的導覽。</p>
            <button
              onClick={() =>
                run("前往 Google…", () => {
                  const back = new URL(location.href);
                  back.searchParams.set("publish", "1");
                  return signInWithGoogle(back.toString());
                })
              }
              disabled={!!busy}
              className="w-full rounded border px-4 py-2.5 font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              用 Google 帳號登入
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              已登入：{user.email}{" "}
              <button onClick={() => signOut()} className="ml-1 text-sky-700 underline">登出</button>
            </p>

            {url ? (
              <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                <p className="font-medium text-emerald-700">✓ 已發布，任何人拿到連結都能看</p>
                <div className="flex gap-2">
                  <input readOnly value={url} className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-xs" onFocus={(e) => e.target.select()} />
                  <button
                    onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}
                    className="rounded bg-slate-900 px-3 py-1 text-white"
                  >
                    {copied ? "已複製" : "複製"}
                  </button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {qr && <img src={qr} alt="導覽 QR Code" className="mx-auto h-40 w-40" />}
                <p className="text-slate-600">之後修改內容，要再按一次「更新發布」，同學才會看到新版本。</p>
              </div>
            ) : (
              <p>發布後會把全景圖上傳到學校的雲端空間。請不要放有個人資料（臉部特寫、門牌、車牌）的照片。</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={publish}
                disabled={!!busy}
                className="flex-1 rounded bg-emerald-600 px-4 py-2.5 font-medium text-white disabled:opacity-50"
              >
                {busy ?? (url ? "更新發布" : "發布")}
              </button>
              {url && (
                <button onClick={unpublish} disabled={!!busy} className="rounded border px-3 py-2 text-red-600 disabled:opacity-50">
                  取消發布
                </button>
              )}
            </div>
          </div>
        )}
        {error && <p className="mt-3 rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      </div>
    </div>
  );
}
