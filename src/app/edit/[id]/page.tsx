"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import PanoViewer, { type PanoViewerHandle } from "@/components/PanoViewer";
import Thumb from "@/components/Thumb";
import { blobUrl, deleteBlob, exportProject, getProject, putBlob, saveProject } from "@/lib/store";
import { processPanorama, processPhoto } from "@/lib/image";
import {
  HOTSPOT_ICON,
  HOTSPOT_LABEL,
  PROJECT_TYPE_LABEL,
  type Hotspot,
  type HotspotType,
  type Project,
  type Scene,
} from "@/lib/types";

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [hotspotId, setHotspotId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<HotspotType | "move" | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const viewer = useRef<PanoViewerHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    getProject(id).then((p) => {
      setProject(p ?? null);
      if (p) setSceneId(p.startSceneId ?? p.scenes[0]?.id ?? null);
    });
  }, [id]);

  const scene = project?.scenes.find((s) => s.id === sceneId) ?? null;
  const hotspot = scene?.hotspots.find((h) => h.id === hotspotId) ?? null;

  useEffect(() => {
    if (scene) blobUrl(scene.imageKey).then(setImageUrl);
    else setImageUrl(undefined);
  }, [scene?.imageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 修改專案並自動儲存 */
  const update = useCallback((fn: (p: Project) => Project) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      setSaved(false);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveProject(next).then(() => setSaved(true)), 400);
      return next;
    });
  }, []);

  const updateScene = (sid: string, fn: (s: Scene) => Scene) =>
    update((p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === sid ? fn(s) : s)) }));

  const updateHotspot = (hid: string, patch: Partial<Hotspot>) => {
    if (!scene) return;
    updateScene(scene.id, (s) => ({ ...s, hotspots: s.hotspots.map((h) => (h.id === hid ? { ...h, ...patch } : h)) }));
  };

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const added: Scene[] = [];
    const warned: string[] = [];
    for (const [i, f] of files.entries()) {
      setBusy(`處理全景圖 ${i + 1}/${files.length}…`);
      try {
        const r = await processPanorama(f);
        if (r.ratioWarning) warned.push(f.name);
        added.push({
          id: nanoid(8),
          name: f.name.replace(/\.[^.]+$/, ""),
          imageKey: await putBlob(r.image),
          thumbKey: await putBlob(r.thumb),
          initialView: { yaw: 0, pitch: 0 },
          hotspots: [],
        });
      } catch {
        alert(`無法讀取「${f.name}」，請確認是 JPG 或 PNG 圖片。`);
      }
    }
    setBusy(null);
    if (!added.length) return;
    update((p) => ({ ...p, scenes: [...p.scenes, ...added], startSceneId: p.startSceneId ?? added[0].id }));
    setSceneId(added[0].id);
    setHotspotId(null);
    if (warned.length)
      alert(`這些圖片不是 2:1 的 360 全景，看起來可能會變形：\n${warned.join("\n")}\n\n360 相機或街景下載的圖片通常是 2:1。`);
  }

  function onPanoClick(pos: { yaw: number; pitch: number }) {
    if (!scene || !placing) return;
    if (placing === "move") {
      if (hotspotId) updateHotspot(hotspotId, pos);
      setPlacing(null);
      return;
    }
    const h: Hotspot = {
      id: nanoid(8),
      type: placing,
      ...pos,
      title: placing === "scene" ? "" : HOTSPOT_LABEL[placing],
      targetSceneId: placing === "scene" ? project!.scenes.find((s) => s.id !== scene.id)?.id : undefined,
    };
    if (placing === "scene" && h.targetSceneId) h.title = `前往 ${project!.scenes.find((s) => s.id === h.targetSceneId)!.name}`;
    updateScene(scene.id, (s) => ({ ...s, hotspots: [...s.hotspots, h] }));
    setHotspotId(h.id);
    setPlacing(null);
  }

  function deleteScene(s: Scene) {
    if (!confirm(`刪除場景「${s.name}」？指向它的跳轉熱點也會一併刪除。`)) return;
    deleteBlob(s.imageKey);
    deleteBlob(s.thumbKey);
    update((p) => {
      const scenes = p.scenes
        .filter((x) => x.id !== s.id)
        .map((x) => ({ ...x, hotspots: x.hotspots.filter((h) => h.targetSceneId !== s.id || h.type !== "scene") }));
      return { ...p, scenes, startSceneId: p.startSceneId === s.id ? scenes[0]?.id : p.startSceneId };
    });
    setSceneId(project!.scenes.find((x) => x.id !== s.id)?.id ?? null);
    setHotspotId(null);
  }

  async function onExport() {
    if (!project) return;
    setBusy("匯出中…");
    await saveProject(project);
    const blob = await exportProject(project.id);
    setBusy(null);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.title}.vr360.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (project === undefined) return <p className="p-8 text-slate-500">讀取中…</p>;
  if (project === null)
    return (
      <p className="p-8">
        找不到這個專案。<Link href="/" className="text-sky-700 underline">回首頁</Link>
      </p>
    );

  return (
    <div className="flex h-dvh flex-col bg-slate-100 text-slate-900">
      {/* 頂端列 */}
      <header className="flex flex-wrap items-center gap-3 border-b bg-white px-4 py-2">
        <Link href="/" className="text-sm text-sky-700">← 我的專案</Link>
        <input
          value={project.title}
          onChange={(e) => update((p) => ({ ...p, title: e.target.value }))}
          className="min-w-0 flex-1 rounded px-2 py-1 text-lg font-semibold hover:bg-slate-50"
          aria-label="專案名稱"
        />
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{PROJECT_TYPE_LABEL[project.type]}</span>
        <span className="text-xs text-slate-500">{saved ? "已儲存" : "儲存中…"}</span>
        <button onClick={onExport} className="rounded border px-3 py-1 text-sm">匯出專案檔</button>
        <Link href={`/view/${project.id}`} target="_blank" className="rounded bg-sky-700 px-3 py-1 text-sm text-white">
          預覽導覽
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 場景列表 */}
        <aside className="w-full shrink-0 overflow-y-auto border-r bg-white p-3 md:w-64">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">場景</h2>
            <button onClick={() => fileRef.current?.click()} className="rounded bg-sky-700 px-2 py-1 text-sm text-white">
              + 上傳 360 照片
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onUpload} data-testid="upload" />
          </div>
          {project.scenes.length === 0 && (
            <p className="text-sm text-slate-500">上傳 360 全景照片（2:1 的 JPG）。可一次選多張，自己拍的、下載的或街景都可以。</p>
          )}
          <ol className="flex gap-2 md:flex-col">
            {project.scenes.map((s, i) => (
              <li key={s.id} className="shrink-0">
                <button
                  onClick={() => {
                    setSceneId(s.id);
                    setHotspotId(null);
                    setPlacing(null);
                  }}
                  className={`block w-40 overflow-hidden rounded-lg border text-left md:w-full ${s.id === sceneId ? "ring-2 ring-sky-600" : ""}`}
                >
                  <Thumb blobKey={s.thumbKey} alt={s.name} className="aspect-[2/1] w-full" />
                  <span className="block truncate px-2 py-1 text-sm">
                    {i + 1}. {s.name}
                    {project.startSceneId === s.id && <span className="ml-1 text-xs text-sky-700">（起點）</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <label className="mt-6 block text-sm">
            專案簡介
            <textarea
              value={project.description}
              onChange={(e) => update((p) => ({ ...p, description: e.target.value }))}
              rows={4}
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="這趟旅程想帶大家看什麼？"
            />
          </label>
        </aside>

        {/* 全景編輯區 */}
        <main className="relative min-h-[50vh] flex-1">
          {scene && imageUrl ? (
            <>
              <PanoViewer
                ref={viewer}
                imageUrl={imageUrl}
                initialView={scene.initialView}
                hotspots={scene.hotspots}
                selectedId={hotspotId}
                crosshair={!!placing}
                onPanoClick={onPanoClick}
                onHotspotClick={(hid) => {
                  setHotspotId(hid);
                  setPlacing(null);
                }}
              />
              <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
                {(Object.keys(HOTSPOT_LABEL) as HotspotType[])
                  .filter((t) => project.type === "art" || t !== "artwork")
                  .map((t) => (
                    <button
                      key={t}
                      onClick={() => setPlacing(placing === t ? null : t)}
                      className={`rounded-full px-3 py-1.5 text-sm shadow ${placing === t ? "bg-yellow-400 text-slate-900" : "bg-white/90"}`}
                    >
                      <span className="mr-1 font-bold">{HOTSPOT_ICON[t]}</span>
                      {HOTSPOT_LABEL[t]}
                    </button>
                  ))}
              </div>
              {placing && (
                <div className="pointer-events-none absolute inset-x-0 top-16 z-10 mx-auto w-fit rounded bg-slate-900/80 px-3 py-1.5 text-sm text-white">
                  {placing === "move" ? "在全景上點一下，把熱點移到那裡" : `在全景上點一下，放置「${HOTSPOT_LABEL[placing]}」熱點`}
                </div>
              )}
            </>
          ) : (
            <div className="grid h-full place-items-center text-slate-500">
              <button onClick={() => fileRef.current?.click()} className="rounded-xl border-2 border-dashed px-8 py-12">
                上傳第一張 360 照片開始製作
              </button>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-white/70 text-slate-700">{busy}</div>
          )}
        </main>

        {/* 右側設定 */}
        {scene && (
          <aside className="w-full shrink-0 overflow-y-auto border-l bg-white p-4 md:w-80">
            {hotspot ? (
              <HotspotForm
                key={hotspot.id}
                hotspot={hotspot}
                scenes={project.scenes.filter((s) => s.id !== scene.id)}
                onChange={(patch) => updateHotspot(hotspot.id, patch)}
                onMove={() => setPlacing("move")}
                onClose={() => setHotspotId(null)}
                onDelete={() => {
                  if (hotspot.imageKey) deleteBlob(hotspot.imageKey);
                  updateScene(scene.id, (s) => ({ ...s, hotspots: s.hotspots.filter((h) => h.id !== hotspot.id) }));
                  setHotspotId(null);
                }}
              />
            ) : (
              <SceneForm
                key={scene.id}
                scene={scene}
                isStart={project.startSceneId === scene.id}
                onChange={(patch) => updateScene(scene.id, (s) => ({ ...s, ...patch }))}
                onSetStart={() => update((p) => ({ ...p, startSceneId: scene.id }))}
                onSetView={() => {
                  const pos = viewer.current?.getPosition();
                  if (pos) updateScene(scene.id, (s) => ({ ...s, initialView: pos }));
                }}
                onDelete={() => deleteScene(scene)}
                onSelectHotspot={setHotspotId}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function SceneForm(props: {
  scene: Scene;
  isStart: boolean;
  onChange: (p: Partial<Scene>) => void;
  onSetStart: () => void;
  onSetView: () => void;
  onDelete: () => void;
  onSelectHotspot: (id: string) => void;
}) {
  const { scene } = props;
  const [viewSaved, setViewSaved] = useState(false);
  return (
    <div className="space-y-4 text-sm">
      <h2 className="font-semibold">場景設定</h2>
      <label className="block">
        場景名稱
        <input value={scene.name} onChange={(e) => props.onChange({ name: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
      </label>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => {
            props.onSetView();
            setViewSaved(true);
            setTimeout(() => setViewSaved(false), 1500);
          }}
          className="rounded border px-3 py-1.5"
        >
          {viewSaved ? "✓ 已設定" : "把目前畫面設為進入時的視角"}
        </button>
        <button onClick={props.onSetStart} disabled={props.isStart} className="rounded border px-3 py-1.5 disabled:opacity-50">
          {props.isStart ? "這是導覽起點" : "設為導覽起點"}
        </button>
      </div>
      <fieldset>
        <legend>地點座標（選填，之後顯示在路線地圖）</legend>
        <div className="mt-1 flex gap-2">
          <input
            type="number"
            step="any"
            placeholder="緯度"
            value={scene.lat ?? ""}
            onChange={(e) => props.onChange({ lat: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="w-1/2 rounded border px-2 py-1"
          />
          <input
            type="number"
            step="any"
            placeholder="經度"
            value={scene.lng ?? ""}
            onChange={(e) => props.onChange({ lng: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="w-1/2 rounded border px-2 py-1"
          />
        </div>
      </fieldset>
      <div>
        <h3 className="mb-1">此場景的熱點（{scene.hotspots.length}）</h3>
        {scene.hotspots.length === 0 ? (
          <p className="text-slate-500">用全景左上角的按鈕新增熱點。</p>
        ) : (
          <ul className="space-y-1">
            {scene.hotspots.map((h) => (
              <li key={h.id}>
                <button onClick={() => props.onSelectHotspot(h.id)} className="w-full rounded px-2 py-1 text-left hover:bg-slate-100">
                  <span className="mr-2 font-bold">{HOTSPOT_ICON[h.type]}</span>
                  {h.title || HOTSPOT_LABEL[h.type]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={props.onDelete} className="text-red-600">刪除這個場景</button>
    </div>
  );
}

function HotspotForm(props: {
  hotspot: Hotspot;
  scenes: Scene[];
  onChange: (p: Partial<Hotspot>) => void;
  onMove: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { hotspot: h } = props;
  const imgRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          <span className="mr-1">{HOTSPOT_ICON[h.type]}</span>
          {HOTSPOT_LABEL[h.type]}熱點
        </h2>
        <button onClick={props.onClose} className="text-sky-700">完成</button>
      </div>

      {h.type === "scene" && (
        <label className="block">
          跳轉到哪個場景
          <select
            value={h.targetSceneId ?? ""}
            onChange={(e) => {
              const target = props.scenes.find((s) => s.id === e.target.value);
              props.onChange({ targetSceneId: e.target.value || undefined, title: target ? `前往 ${target.name}` : h.title });
            }}
            className="mt-1 w-full rounded border px-2 py-1"
          >
            <option value="">（請選擇）</option>
            {props.scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {props.scenes.length === 0 && <span className="mt-1 block text-amber-700">先上傳第二個場景，才能設定跳轉。</span>}
        </label>
      )}

      <label className="block">
        {h.type === "artwork" ? "作品名稱" : "標題"}
        <input value={h.title} onChange={(e) => props.onChange({ title: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
      </label>

      {h.type === "artwork" && (
        <div className="flex gap-2">
          <label className="block w-2/3">
            藝術家
            <input value={h.artist ?? ""} onChange={(e) => props.onChange({ artist: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
          </label>
          <label className="block w-1/3">
            年代
            <input value={h.year ?? ""} onChange={(e) => props.onChange({ year: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
          </label>
        </div>
      )}

      {h.type !== "scene" && (
        <label className="block">
          {h.type === "artwork" ? "賞析（我看到什麼、我的感受、背景知識）" : h.type === "image" ? "圖片說明" : "說明文字"}
          <textarea
            value={h.text ?? ""}
            onChange={(e) => props.onChange({ text: e.target.value })}
            rows={6}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>
      )}

      {(h.type === "image" || h.type === "artwork") && (
        <div>
          <p className="mb-1">{h.type === "artwork" ? "作品照片（選填）" : "圖片"}</p>
          {h.imageKey && <Thumb blobKey={h.imageKey} alt={h.title} className="mb-2 max-h-40 w-full rounded !object-contain" />}
          <button onClick={() => imgRef.current?.click()} className="rounded border px-3 py-1.5">
            {h.imageKey ? "更換圖片" : "上傳圖片"}
          </button>
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const old = h.imageKey;
              props.onChange({ imageKey: await putBlob(await processPhoto(f)) });
              if (old) deleteBlob(old);
            }}
          />
        </div>
      )}

      <div className="flex gap-3 border-t pt-4">
        <button onClick={props.onMove} className="rounded border px-3 py-1.5">移動位置</button>
        <button onClick={props.onDelete} className="ml-auto text-red-600">刪除熱點</button>
      </div>
    </div>
  );
}
