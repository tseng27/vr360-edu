"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import PanoViewer from "@/components/PanoViewer";
import Thumb from "@/components/Thumb";
import { blobUrl, getProject, setRemoteMedia } from "@/lib/store";
import { cloudStatus, loadPublished, publicMediaUrl } from "@/lib/publish";
import { HOTSPOT_ICON, PROJECT_TYPE_LABEL, type Hotspot, type Project } from "@/lib/types";
import VRLauncher from "@/features/vr/VRLauncher";
import type { VRCard, VRSceneInput } from "@/features/vr/engine";

async function loadProject(id: string, pub: string): Promise<Project | null> {
  if (pub) {
    if (cloudStatus !== "ready") throw new Error("這個網站還沒有設定雲端，無法開啟已發布的導覽。");
    const d = await loadPublished(pub);
    if (!d) return null;
    setRemoteMedia(Object.fromEntries(Object.entries(d.media).map(([k, path]) => [k, publicMediaUrl(path)])));
    return d.project;
  }
  return (await getProject(id)) ?? null;
}

function ViewPageInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const pub = params.get("pub") ?? "";
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [card, setCard] = useState<Hotspot | null>(null);
  const [cardImage, setCardImage] = useState<string>();
  const [intro, setIntro] = useState(true);
  const [stripOpen, setStripOpen] = useState(true);
  // VR 模式時卸載一般播放器，手機上不要同時佔兩份 GPU 記憶體
  const [vrActive, setVrActive] = useState(false);

  useEffect(() => {
    loadProject(id, pub)
      .then((p) => {
        setProject(p);
        if (p) setSceneId(p.startSceneId ?? p.scenes[0]?.id ?? null);
      })
      .catch((e: Error) => {
        setLoadError(e.message);
        setProject(null);
      });
  }, [id, pub]);

  const scene = project?.scenes.find((s) => s.id === sceneId);
  const sceneIndex = project?.scenes.findIndex((s) => s.id === sceneId) ?? -1;

  useEffect(() => {
    if (scene) blobUrl(scene.imageKey).then(setImageUrl);
  }, [scene?.imageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCardImage(undefined);
    if (card?.imageKey) blobUrl(card.imageKey).then(setCardImage);
  }, [card]);

  const visibleHotspots = useMemo(
    () => scene?.hotspots.filter((h) => h.type !== "scene" || h.targetSceneId) ?? [],
    [scene],
  );

  // 給 VR 模式用的場景資料
  const vrScene = useMemo<VRSceneInput | null>(
    () =>
      scene && imageUrl && project
        ? {
            imageUrl,
            name: scene.name,
            index: sceneIndex,
            total: project.scenes.length,
            initialYaw: scene.initialView.yaw,
            hotspots: visibleHotspots.map((h) => ({ id: h.id, type: h.type, yaw: h.yaw, pitch: h.pitch, title: h.title, icon: HOTSPOT_ICON[h.type] })),
          }
        : null,
    [scene, imageUrl, project, sceneIndex, visibleHotspots],
  );
  const vrCard = useMemo<VRCard | null>(
    () =>
      card
        ? {
            kicker: card.type === "artwork" ? "藝術作品" : undefined,
            title: card.title,
            subtitle: card.type === "artwork" ? [card.artist, card.year].filter(Boolean).join("，") || undefined : undefined,
            body: card.text,
            imageUrl: cardImage,
          }
        : null,
    [card, cardImage],
  );

  function goto(sid: string) {
    setCard(null);
    setSceneId(sid);
  }

  function step(d: number) {
    if (!project || sceneIndex < 0) return;
    const n = project.scenes.length;
    goto(project.scenes[(sceneIndex + d + n) % n].id);
  }

  function onHotspot(hid: string) {
    const h = scene?.hotspots.find((x) => x.id === hid);
    if (!h) return;
    if (h.type === "scene") {
      if (h.targetSceneId) goto(h.targetSceneId);
    } else setCard(h);
  }

  if (project === undefined) return <p className="p-8 text-slate-500">讀取中…</p>;
  if (project === null || !scene)
    return (
      <p className="p-8">
        {loadError ?? (project ? "這個專案還沒有場景。" : pub ? "找不到這個導覽，可能已經取消發布。" : "找不到這個專案。")}
        <Link href="/" className="ml-2 text-sky-700 underline">回首頁</Link>
      </p>
    );

  return (
    <div className="fixed inset-0 bg-black text-white">
      {imageUrl && !vrActive && (
        <PanoViewer
          imageUrl={imageUrl}
          initialView={scene.initialView}
          hotspots={visibleHotspots}
          onHotspotClick={onHotspot}
          gyroscope
        />
      )}

      {/* 標題 */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-black/60 to-transparent p-4 pr-44">
        <p className="text-xs opacity-80">{PROJECT_TYPE_LABEL[project.type]}{project.author && ` · ${project.author}`}</p>
        <h1 className="text-lg font-semibold">{project.title}</h1>
        <p className="text-sm opacity-90">{scene.name}</p>
      </div>

      {/* VR 按鈕 */}
      <div className="absolute right-3 top-3 z-20">
        <VRLauncher scene={vrScene} card={vrCard} onHotspot={onHotspot} onPrev={() => step(-1)} onNext={() => step(1)} onActiveChange={setVrActive} />
      </div>

      {/* 場景縮圖列 */}
      {project.scenes.length > 1 && (
        <div className="absolute inset-x-0 bottom-12 z-10 flex flex-col items-center gap-2">
          <button onClick={() => setStripOpen(!stripOpen)} className="rounded-full bg-black/60 px-3 py-1 text-xs">
            {stripOpen ? "隱藏場景" : "顯示場景"}
          </button>
          {stripOpen && (
            <ol className="flex max-w-full gap-2 overflow-x-auto px-4">
              {project.scenes.map((s, i) => (
                <li key={s.id}>
                  <button
                    onClick={() => goto(s.id)}
                    className={`block w-28 overflow-hidden rounded-md border-2 bg-black/50 text-left ${s.id === sceneId ? "border-yellow-400" : "border-transparent"}`}
                  >
                    <Thumb blobKey={s.thumbKey} alt={s.name} className="aspect-[2/1] w-full" />
                    <span className="block truncate px-1.5 py-0.5 text-xs">{i + 1}. {s.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* 熱點卡片 */}
      {card && !vrActive && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/40 p-4" onClick={() => setCard(null)}>
          <article
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 text-slate-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={card.title}
          >
            {card.imageKey && <Thumb blobKey={card.imageKey} alt={card.title} className="mb-4 max-h-80 w-full rounded !object-contain" />}
            {card.type === "artwork" && <p className="text-xs uppercase tracking-wider text-amber-700">藝術作品</p>}
            <h2 className="text-xl font-semibold">{card.title}</h2>
            {card.type === "artwork" && (card.artist || card.year) && (
              <p className="mt-1 text-slate-600">{[card.artist, card.year].filter(Boolean).join("，")}</p>
            )}
            {card.text && <p className="mt-3 whitespace-pre-wrap leading-relaxed">{card.text}</p>}
            <button onClick={() => setCard(null)} className="mt-5 rounded bg-slate-900 px-4 py-2 text-white">關閉</button>
          </article>
        </div>
      )}

      {/* 開場介紹 */}
      {intro && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 text-slate-900">
            <p className="text-xs text-slate-500">{PROJECT_TYPE_LABEL[project.type]}</p>
            <h1 className="mt-1 text-2xl font-bold">{project.title}</h1>
            {project.author && <p className="mt-1 text-slate-600">{project.author}</p>}
            {project.description && <p className="mt-4 whitespace-pre-wrap">{project.description}</p>}
            <p className="mt-4 text-sm text-slate-500">
              拖曳畫面環顧四周，點圓形圖示看說明或前往下一站。手機可開啟陀螺儀；有 VR 眼鏡或頭盔，按右上角的 VR 按鈕。
            </p>
            <button onClick={() => setIntro(false)} className="mt-5 w-full rounded bg-sky-700 py-2.5 font-medium text-white">
              開始導覽（{project.scenes.length} 個場景）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 用 ?id= 查詢參數（而不是 /[id] 動態路由），才能靜態匯出到 GitHub Pages
export default function ViewPage() {
  return (
    <Suspense fallback={<p className="p-8 text-slate-500">讀取中…</p>}>
      <ViewPageInner />
    </Suspense>
  );
}
