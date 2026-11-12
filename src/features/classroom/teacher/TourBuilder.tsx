"use client";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { listProjects } from "@/lib/store";
import type { Project } from "@/lib/types";
import { getBackend, type SavedTourSummary } from "../backend";
import { asset, config } from "../config";
import { DEMO_TOUR } from "../demoTour";
import { TourSchema, normalizeYaw, clampPitch, toDeg, type Scene, type Tour } from "../protocol";

/** 建立導覽：預設三個示範場景，可改名、寫介紹、調順序、上傳自己的全景 */
const DRAFT_KEY = "classroom-tour-draft";

function loadDraft(): { tour: Tour; savedId: string | null; dirty: boolean } | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    const t = TourSchema.safeParse(d?.tour);
    return t.success ? { tour: t.data, savedId: typeof d.savedId === "string" ? d.savedId : null, dirty: !!d.dirty } : null;
  } catch {
    return null;
  }
}

/** 建立導覽：預設三個示範場景，可改名、寫介紹、調順序、上傳自己的全景；可存成「我的導覽」 */
export default function TourBuilder({ onCreate, busy }: { onCreate: (tour: Tour, ttl: number) => void; busy: boolean }) {
  const [tour, setTourRaw] = useState<Tour>(DEMO_TOUR);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<SavedTourSummary[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const draftLoaded = useRef(false);
  // 所有修改都經過這裡：標記「尚未儲存」
  const setTour: typeof setTourRaw = (v) => {
    setTourRaw(v);
    setDirty(true);
    setNotice(null);
  };
  const [ttl, setTtl] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (config.backend === "mock") listProjects().then(setProjects).catch(() => {});
    // 重新整理後接回上次編輯到一半的內容（只存在這台電腦的瀏覽器）
    const d = loadDraft();
    if (d) {
      setTourRaw(d.tour);
      setSavedId(d.savedId);
      setDirty(d.dirty);
    }
    draftLoaded.current = true;
    refreshSaved();
  }, []);

  useEffect(() => {
    if (!draftLoaded.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ tour, savedId, dirty }));
    } catch {
      /* 空間不足就算了 */
    }
  }, [tour, savedId, dirty]);

  async function refreshSaved() {
    try {
      setSaved(await getBackend().listSavedTours());
      setSavedError(null);
    } catch (e) {
      setSaved([]);
      setSavedError((e as Error).message);
    }
  }

  async function save(asNew: boolean) {
    setError(null);
    const parsed = TourSchema.safeParse(tour);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setSaving(true);
    try {
      const r = await getBackend().saveTour(parsed.data, asNew ? null : savedId);
      setSavedId(r.id);
      setDirty(false);
      setNotice(`已儲存「${parsed.data.title}」`);
      await refreshSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function open(id: string) {
    if (dirty && !confirm("目前的修改還沒儲存，確定要換成另一份導覽嗎？")) return;
    setError(null);
    try {
      const t = await getBackend().loadSavedTour(id);
      setTourRaw(t);
      setSavedId(id);
      setDirty(false);
      setNotice(`已開啟「${t.title}」`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeSaved() {
    if (!savedId) return;
    const title = saved?.find((x) => x.id === savedId)?.title ?? tour.title;
    if (!confirm(`確定要刪除「${title}」嗎？（已上傳的照片不會被刪除）`)) return;
    try {
      await getBackend().deleteSavedTour(savedId);
      setSavedId(null);
      setDirty(true);
      setNotice(`已刪除「${title}」，畫面上的內容還在，可以另存新的`);
      await refreshSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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

  const current = saved?.find((x) => x.id === savedId);
  return (
    <section className="space-y-5">
      <div data-testid="my-tours" className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3 text-sm">
        <span className="font-semibold">我的導覽</span>
        <select
          aria-label="開啟我的導覽"
          className="min-w-[12rem] rounded border px-2 py-1.5"
          value=""
          onChange={(e) => e.target.value && open(e.target.value)}
          disabled={!saved?.length}
        >
          <option value="">{saved === null ? "讀取中…" : saved.length ? `開啟已儲存的導覽（${saved.length} 份）…` : "還沒有儲存的導覽"}</option>
          {saved?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}（{t.sceneCount} 個場景，{new Date(t.updatedAt).toLocaleDateString("zh-TW")}）
            </option>
          ))}
        </select>
        <button data-testid="save-tour" onClick={() => save(false)} disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
          {saving ? "儲存中…" : current ? "儲存" : "儲存導覽"}
        </button>
        {current && (
          <>
            <button onClick={() => save(true)} disabled={saving} className="rounded border px-3 py-1.5">另存新的一份</button>
            <button onClick={removeSaved} className="rounded border px-3 py-1.5 text-rose-700">刪除這份</button>
          </>
        )}
        <span data-testid="save-status" className="ml-auto text-xs text-slate-500">
          {notice ?? (current ? (dirty ? `「${current.title}」有修改尚未儲存` : `目前是「${current.title}」`) : dirty ? "尚未儲存" : "")}
        </span>
        {savedError && <p className="w-full text-xs text-amber-700">{savedError}</p>}
      </div>

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
        <button
          onClick={() => {
            if (dirty && !confirm("目前的修改還沒儲存，確定要換回示範導覽嗎？")) return;
            setTour(DEMO_TOUR);
            setSavedId(null);
          }}
          className="rounded border bg-white px-3 py-2 text-sm"
        >
          恢復示範導覽
        </button>
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
