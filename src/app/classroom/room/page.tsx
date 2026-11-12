"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { assertTourMediaAllowed, ClassroomError, getBackend, type ConnectionStatus, type RoomSnapshot } from "@/features/classroom/backend";
import ClassroomPano, { type ClassroomPanoHandle } from "@/features/classroom/components/ClassroomPano";
import LookHint from "@/features/classroom/components/LookHint";
import XRMode from "@/features/classroom/components/XRMode";
import { asset } from "@/features/classroom/config";
import type { InfoHotspot, LookTarget } from "@/features/classroom/protocol";
import { applyEvent, visibleSceneId } from "@/features/classroom/reducer";
import { loadStudentSession } from "@/features/classroom/session";

const CONN_LABEL: Record<ConnectionStatus, string> = {
  connecting: "連線中…",
  online: "已連線",
  offline: "連線中斷，正在重新連線…",
  error: "連線失敗",
};

function StudentRoom() {
  const router = useRouter();
  const params = useSearchParams();
  const roomId = params.get("id") ?? "";
  const backend = getBackend();

  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const snapRef = useRef<RoomSnapshot | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionStatus>("connecting");
  const [localScene, setLocalScene] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageError, setImageError] = useState(false);
  const [pos, setPos] = useState<LookTarget | null>(null);
  const [cardHidden, setCardHidden] = useState(false);
  const [hotspot, setHotspot] = useState<InfoHotspot | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const pano = useRef<ClassroomPanoHandle>(null);
  const me = useRef(loadStudentSession());
  const subRef = useRef<ReturnType<typeof backend.subscribe> | null>(null);

  const setSnapshot = useCallback((s: RoomSnapshot) => {
    snapRef.current = s;
    setSnap(s);
  }, []);

  /** 一律先讀後端快照（加入、重新整理、重連、序號跳號），再吃增量事件 */
  const reload = useCallback(async () => {
    try {
      const s = await backend.fetchSnapshot(roomId);
      assertTourMediaAllowed(s.tour);
      const cur = snapRef.current;
      if (!cur || s.state.sequenceNumber >= cur.state.sequenceNumber) setSnapshot(s);
      setFatal(null);
    } catch (e) {
      if (e instanceof ClassroomError && e.code === "not-member") {
        router.replace(`/classroom/join?msg=${encodeURIComponent("請先輸入教室代碼加入")}`);
        return;
      }
      if (!snapRef.current) setFatal((e as Error).message || "讀取教室失敗");
      else setConn("offline");
    }
  }, [backend, roomId, router, setSnapshot]);

  useEffect(() => {
    if (!roomId || !me.current || me.current.roomId !== roomId) {
      router.replace(`/classroom/join?msg=${encodeURIComponent("請先輸入教室代碼加入")}`);
      return;
    }
    let sub: ReturnType<typeof backend.subscribe> | null = null;
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled || !snapRef.current) return;
      const s = snapRef.current;
      sub = backend.subscribe(
        roomId,
        {
          onEvent(raw) {
            const cur = snapRef.current;
            if (!cur) return;
            const r = applyEvent(cur.state, raw, cur.tour);
            if (!r.applied) return; // 舊的、重複的、非老師送的事件一律忽略
            setSnapshot({ ...cur, state: r.state });
            if (r.gap) reload();
          },
          onStatus(st, detail) {
            setConn(st);
            if (st === "online" && detail === "reconnected") reload();
          },
        },
        {
          userId: me.current!.userId,
          role: "student",
          displayName: me.current!.displayName,
          seq: s.state.sequenceNumber,
          sceneId: s.state.activeSceneId,
        },
      );
      subRef.current = sub;
    })();
    const onVisible = () => document.visibilityState === "visible" && reload();
    const onOnline = () => reload();
    const onOffline = () => setConn("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      sub?.close();
      subRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, retryKey]);

  const state = snap?.state;
  const tour = snap?.tour;
  const sceneId = state ? visibleSceneId(state, localScene) : null;
  const scene = tour?.scenes.find((s) => s.sceneId === sceneId) ?? tour?.scenes[0];

  // 切回跟隨模式：放掉自己選的場景，重新對齊老師
  useEffect(() => {
    if (state?.mode === "follow") setLocalScene(null);
  }, [state?.mode]);

  // 老師換場景時提示一下
  const lastScene = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    if (lastScene.current && lastScene.current !== state.activeSceneId && state.mode === "follow") {
      const n = tour?.scenes.find((s) => s.sceneId === state.activeSceneId)?.name;
      setFlash(`老師帶大家前往：${n}`);
      const t = setTimeout(() => setFlash(null), 2500);
      lastScene.current = state.activeSceneId;
      return () => clearTimeout(t);
    }
    lastScene.current = state.activeSceneId;
  }, [state, tour]);

  useEffect(() => {
    setCardHidden(false);
  }, [state?.card?.text, state?.card?.title, state?.card?.visible]);

  useEffect(() => {
    if (!scene) return;
    let alive = true;
    setImageError(false);
    backend
      .resolveImageUrl(asset(scene.panoramaUrl))
      .then((u) => alive && setImageUrl(u))
      .catch(() => alive && setImageError(true));
    return () => {
      alive = false;
    };
  }, [backend, scene]);

  // Presence：只回報「我已同步到第幾號、在哪個場景」，不傳頭部轉向
  useEffect(() => {
    if (!state || !me.current || !sceneId) return;
    subRef.current?.updatePresence({
      userId: me.current.userId,
      role: "student",
      displayName: me.current.displayName,
      seq: state.sequenceNumber,
      sceneId,
    });
  }, [state?.sequenceNumber, sceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fatal)
    return (
      <Centered>
        <p role="alert">{fatal}</p>
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={() => setRetryKey((k) => k + 1)} className="rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-900">重試</button>
          <Link href="/classroom/join" className="rounded bg-slate-700 px-4 py-2">重新輸入代碼</Link>
        </div>
      </Centered>
    );
  if (!state || !tour || !scene) return <Centered>正在進入教室…</Centered>;

  if (state.status === "ended")
    return (
      <Centered>
        <p className="text-2xl font-semibold" data-testid="session-ended">這堂導覽結束了</p>
        <p className="mt-2 text-slate-300">謝謝參與！你的暱稱等資料會在 24 小時內自動刪除。</p>
        <Link href="/classroom/join" className="mt-5 inline-block rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-900">加入其他教室</Link>
      </Centered>
    );

  const showLook = state.lookHere && sceneId === state.activeSceneId;

  return (
    <div className="fixed inset-0 bg-black text-white" data-testid="student-room" data-scene={scene.sceneId} data-seq={state.sequenceNumber} data-mode={state.mode}>
      {imageUrl && !imageError && (
        <ClassroomPano
          ref={pano}
          imageUrl={imageUrl}
          initialView={{ yaw: scene.initialYaw, pitch: scene.initialPitch }}
          lookHere={showLook ? state.lookHere : null}
          hotspots={scene.infoHotspots}
          onHotspot={setHotspot}
          onPosition={setPos}
          onLoadError={() => setImageError(true)}
          gyroscope
        />
      )}
      {imageError && (
        <div role="alert" className="absolute inset-0 z-10 grid place-items-center p-6 text-center">
          <div>
            <p>這個場景的全景圖載入失敗。</p>
            <button onClick={() => { setImageUrl(undefined); setImageError(false); setRetryKey((k) => k + 1); }} className="mt-3 rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-900">重新載入</button>
          </div>
        </div>
      )}

      {/* 頂部資訊 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pb-10">
        <div>
          <p className="text-xs opacity-80">{tour.title}</p>
          <h1 className="text-lg font-semibold" data-testid="scene-name">{scene.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 ${state.mode === "follow" ? "bg-cyan-600" : "bg-emerald-600"}`} data-testid="mode-badge">
              {state.mode === "follow" ? "跟隨老師導覽" : "自由探索"}
            </span>
            <span className={`rounded-full px-2 py-0.5 ${conn === "online" ? "bg-black/40" : "bg-amber-600"}`} data-testid="conn">
              {CONN_LABEL[conn]}
            </span>
            <span className="opacity-80">{me.current?.displayName}</span>
          </p>
        </div>
        <div className="pointer-events-auto">
          <XRMode imageUrl={imageUrl} lookHere={showLook ? state.lookHere : null} />
        </div>
      </div>

      {conn !== "online" && conn !== "connecting" && (
        <div className="absolute inset-x-0 top-28 z-20 mx-auto w-fit rounded-full bg-amber-600 px-4 py-1.5 text-sm">
          {CONN_LABEL[conn]}
          <button onClick={() => setRetryKey((k) => k + 1)} className="ml-3 underline">立即重試</button>
        </div>
      )}

      {showLook && <LookHint current={pos} target={state.lookHere!} onGo={() => pano.current?.lookAt(state.lookHere!)} />}

      {flash && (
        <div role="status" className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/70 px-5 py-3 text-lg">
          {flash}
        </div>
      )}

      {/* 解說卡（純文字顯示） */}
      {state.card?.visible && !cardHidden && (
        <aside data-testid="card" className="absolute inset-x-3 bottom-24 z-20 mx-auto max-w-lg rounded-2xl bg-white/95 p-4 text-slate-900 shadow-xl">
          {state.card.title && <h2 className="font-semibold">{state.card.title}</h2>}
          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{state.card.text}</p>
          <button onClick={() => setCardHidden(true)} className="mt-3 text-sm text-slate-500 underline">先收起來</button>
        </aside>
      )}
      {state.card?.visible && cardHidden && (
        <button onClick={() => setCardHidden(false)} className="absolute bottom-24 right-3 z-20 rounded-full bg-white px-3 py-2 text-sm text-slate-900">
          打開解說卡
        </button>
      )}

      {hotspot && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/40 p-4" onClick={() => setHotspot(null)}>
          <article role="dialog" aria-label={hotspot.title} onClick={(e) => e.stopPropagation()} className="max-w-md rounded-xl bg-white p-5 text-slate-900">
            <h2 className="text-lg font-semibold">{hotspot.title}</h2>
            {hotspot.text && <p className="mt-2 whitespace-pre-wrap">{hotspot.text}</p>}
            <button onClick={() => setHotspot(null)} className="mt-4 rounded bg-slate-900 px-4 py-2 text-white">關閉</button>
          </article>
        </div>
      )}

      {/* 底部：自由探索時可自己選場景 */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-6">
        {state.mode === "explore" ? (
          <ol className="flex gap-2 overflow-x-auto" aria-label="選擇場景">
            {tour.scenes.map((s, i) => (
              <li key={s.sceneId}>
                <button
                  onClick={() => setLocalScene(s.sceneId)}
                  aria-current={s.sceneId === scene.sceneId}
                  className={`block w-28 overflow-hidden rounded-md border-2 bg-black/50 text-left ${s.sceneId === scene.sceneId ? "border-yellow-400" : "border-transparent"}`}
                >
                  {s.thumbUrl && <ThumbImg url={s.thumbUrl} alt="" />}
                  <span className="block truncate px-1.5 py-0.5 text-xs">{i + 1}. {s.name}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-center text-sm opacity-80">老師帶隊中 · 拖曳或轉動手機看看四周</p>
        )}
        {scene.credit && <p className="mt-1 text-right text-[10px] opacity-60">{scene.credit}</p>}
      </div>
    </div>
  );
}

function ThumbImg({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    getBackend().resolveImageUrl(asset(url)).then(setSrc).catch(() => {});
  }, [url]);
  if (!src) return <div className="aspect-[2/1] w-full bg-slate-700" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="aspect-[2/1] w-full object-cover" />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-slate-900 p-6 text-center text-white"><div>{children}</div></main>;
}

export default function RoomPage() {
  return (
    <Suspense fallback={<Centered>載入中…</Centered>}>
      <StudentRoom />
    </Suspense>
  );
}
