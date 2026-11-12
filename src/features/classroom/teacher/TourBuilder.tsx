"use client";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { listProjects } from "@/lib/store";
import type { Project } from "@/lib/types";
import { getBackend } from "../backend";
import { asset, config } from "../config";
import { DEMO_TOUR } from "../demoTour";
import { TourSchema, normalizeYaw, clampPitch, toDeg, type Scene, type Tour } from "../protocol";

/** 建立導覽：預設三個示範場景，可改名、寫介紹、調順序、上傳自己的全景 */
export default function TourBuilder({ onCreate, busy }: { onCreate: (tour: Tour, ttl: number) => void; busy: boolean }) {
  const [tour, setTour] = useState<Tour>(DEMO_TOUR);
  const [ttl, setTtl] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (config.backend === "mock") listProjects().then(setProjects).catch(() => {});
  }, []);

  const update = (i: number, patch: Partial<Scene>) =>
    setTour((t) => ({ ...t, scenes: t.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setTour((t) => {
      const scenes = [...t.scenes];
      const j = i + d;
      if (j < 0 || j >= scenes.length) return t;
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
      return { ...t, scenes };
    });
  const remove = (i: number) => setTour((t) => ({ ...t, scenes: t.scenes.filter((_, j) => j !== i) }));

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of files) {
        const { panoramaUrl, thumbUrl } = await getBackend().uploadPanorama(f);
        const name = f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "新場景";
        setTour((t) => ({
          ...t,
          scenes: [
            ...t.scenes,
            { sceneId: "s-" + nanoid(8), name, intro: "", panoramaUrl, thumbUrl, initialYaw: 0, initialPitch: 0, infoHotspots: [] },
          ],
        }));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function importProject(p: Project) {
    const scenes: Scene[] = p.scenes.slice(0, 30).map((s) => ({
      sceneId: "p-" + s.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40),
      name: s.name.slice(0, 40) || "場景",
      intro: "",
      panoramaUrl: `idb:vr360:${s.imageKey}`,
      thumbUrl: `idb:vr360:${s.thumbKey}`,
      initialYaw: normalizeYaw(toDeg(s.initialView.yaw)),
      initialPitch: clampPitch(toDeg(s.initialView.pitch)),
      infoHotspots: s.hotspots
        .filter((h) => h.type === "info" || h.type === "artwork")
        .slice(0, 30)
        .map((h) => ({
          id: h.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || nanoid(6),
          yaw: normalizeYaw(toDeg(h.yaw)),
          pitch: clampPitch(toDeg(h.pitch)),
          title: h.title.slice(0, 60),
          text: (h.text ?? "").slice(0, 500),
        })),
    }));
    if (!scenes.length) return setError("這個專案還沒有場景");
    setTour({ tourId: "p-" + p.id.replace(/[^A-Za-z0-9_-]/g, ""), title: p.title.slice(0, 60) || "我的導覽", scenes });
  }

  function submit() {
    setError(null);
    const parsed = TourSchema.safeParse(tour);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    onCreate(parsed.data, ttl);
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          導覽名稱
          <input value={tour.title} maxLength={60} onChange={(e) => setTour({ ...tour, title: e.target.value })} className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          教室開放時間
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="rounded border px-3 py-2">
            <option value={50}>50 分鐘（一節課）</option>
            <option value={120}>2 小時</option>
            <option value={240}>4 小時</option>
          </select>
        </label>
      </div>

      <ol className="space-y-3" aria-label="場景順序">
        {tour.scenes.map((s, i) => (
          <li key={s.sceneId} className="flex gap-3 rounded-lg border bg-white p-3">
            <SceneThumb url={s.thumbUrl ?? s.panoramaUrl} />
            <div className="flex flex-1 flex-col gap-2">
              <input
                aria-label={`第 ${i + 1} 站名稱`}
                value={s.name}
                maxLength={40}
                onChange={(e) => update(i, { name: e.target.value })}
                className="rounded border px-2 py-1 font-medium"
              />
              <textarea
                aria-label={`第 ${i + 1} 站介紹`}
                value={s.intro}
                maxLength={500}
                rows={2}
                placeholder="介紹（可當作解說卡內容）"
                onChange={(e) => update(i, { intro: e.target.value })}
                className="rounded border px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border px-2 text-sm disabled:opacity-30" aria-label="往前移">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === tour.scenes.length - 1} className="rounded border px-2 text-sm disabled:opacity-30" aria-label="往後移">▼</button>
              <button onClick={() => remove(i)} disabled={tour.scenes.length <= 1} className="rounded border px-2 text-sm text-rose-700 disabled:opacity-30" aria-label="刪除">✕</button>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3">
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded border bg-white px-3 py-2 text-sm">
          {uploading ? "處理中…" : "＋ 上傳 2:1 全景照片"}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onUpload} />
        <button onClick={() => setTour(DEMO_TOUR)} className="rounded border bg-white px-3 py-2 text-sm">恢復示範導覽</button>
        {projects.length > 0 && (
          <select
            className="rounded border bg-white px-3 py-2 text-sm"
            value=""
            onChange={(e) => {
              const p = projects.find((x) => x.id === e.target.value);
              if (p) importProject(p);
            }}
          >
            <option value="">從我的 360 專案匯入…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}（{p.scenes.length} 個場景）</option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs text-slate-500">上傳的照片會重新壓縮並移除 EXIF（含 GPS 位置）。請只使用自己拍攝或有授權的照片。</p>

      {error && <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
      <button onClick={submit} disabled={busy || uploading} className="w-full rounded-xl bg-cyan-700 py-3 text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "建立中…" : `建立教室（${tour.scenes.length} 個場景）`}
      </button>
    </section>
  );
}

function SceneThumb({ url }: { url: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    getBackend().resolveImageUrl(asset(url)).then(setSrc).catch(() => setSrc(undefined));
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="h-16 w-32 rounded object-cover" /> : <div className="h-16 w-32 rounded bg-slate-200" />;
}
