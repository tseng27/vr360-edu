"use client";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBackend, type ConnectionStatus, type PresenceMember } from "../backend";
import ClassroomPano, { type ClassroomPanoHandle } from "../components/ClassroomPano";
import { asset, config } from "../config";
import type { RoomState, TeacherAction, Tour } from "../protocol";

interface Props {
  roomId: string;
  joinCode: string;
  tour: Tour;
  initialState: RoomState;
  teacherUserId: string;
  onEnded: () => void;
}

const ACTION_LABEL: Record<TeacherAction["type"], string> = {
  SCENE_CHANGE: "切換場景",
  LOOK_HERE: "方向提示",
  MODE_CHANGE: "切換模式",
  SHOW_CARD: "解說卡",
  SESSION_END: "結束課堂",
};

export default function TeacherConsole({ roomId, joinCode, tour, initialState, teacherUserId, onEnded }: Props) {
  const backend = getBackend();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [conn, setConn] = useState<ConnectionStatus>("connecting");
  const [qr, setQr] = useState<string>();
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err" | "busy"; text: string } | null>(null);
  const [cardTitle, setCardTitle] = useState("");
  const [cardText, setCardText] = useState("");
  const [imageUrl, setImageUrl] = useState<string>();
  const [showQrBig, setShowQrBig] = useState(false);
  const pano = useRef<ClassroomPanoHandle>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const subRef = useRef<ReturnType<typeof backend.subscribe> | null>(null);
  const [pending, setPending] = useState(false);

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${config.basePath}/classroom/join?code=${joinCode}`;
  }, [joinCode]);

  useEffect(() => {
    if (joinUrl && joinCode) QRCode.toDataURL(joinUrl, { margin: 1, width: 480, errorCorrectionLevel: "M" }).then(setQr);
  }, [joinUrl, joinCode]);

  const sceneIndex = tour.scenes.findIndex((s) => s.sceneId === state.activeSceneId);
  const scene = tour.scenes[sceneIndex] ?? tour.scenes[0];

  useEffect(() => {
    setCardTitle(scene.name);
    setCardText(scene.intro);
    backend.resolveImageUrl(asset(scene.panoramaUrl)).then(setImageUrl).catch(() => setImageUrl(undefined));
  }, [backend, scene]);

  // 老師也訂閱頻道：看 presence（誰在線上、同步到第幾號）
  useEffect(() => {
    const sub = backend.subscribe(
      roomId,
      {
        onEvent() {},
        onPresence: (list) => setMembers(list.filter((m) => m.role === "student")),
        onStatus: (st) => setConn(st),
      },
      { userId: teacherUserId, role: "teacher", displayName: "老師", seq: stateRef.current.sequenceNumber, sceneId: stateRef.current.activeSceneId },
    );
    subRef.current = sub;
    return () => sub.close();
  }, [backend, roomId, teacherUserId]);

  /** 指令依序送出（不會因為連點重複送），每次以後端回傳的狀態為準 */
  function act(action: TeacherAction) {
    setPending(true);
    setFeedback({ kind: "busy", text: `${ACTION_LABEL[action.type]}：送出中…` });
    queue.current = queue.current.then(async () => {
      try {
        const next = await backend.teacherAct(roomId, action);
        stateRef.current = next;
        setState(next);
        setFeedback({ kind: "ok", text: `${ACTION_LABEL[action.type]}：已送出（#${next.sequenceNumber}）` });
        subRef.current?.updatePresence({ userId: teacherUserId, role: "teacher", displayName: "老師", seq: next.sequenceNumber, sceneId: next.activeSceneId });
        if (next.status === "ended") onEnded();
      } catch (e) {
        setFeedback({ kind: "err", text: `${ACTION_LABEL[action.type]}失敗：${(e as Error).message}` });
      } finally {
        setPending(false);
      }
    });
  }

  const synced = members.filter((m) => m.seq >= state.sequenceNumber).length;
  const goScene = (i: number) => tour.scenes[i] && act({ type: "SCENE_CHANGE", sceneId: tour.scenes[i].sceneId });

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      {/* 左：加入資訊與學生名單 */}
      <aside className="space-y-4">
        <div className="rounded-xl bg-slate-900 p-4 text-white">
          <p className="text-sm opacity-80">教室代碼</p>
          <p className="font-mono text-5xl font-bold tracking-[0.2em]" data-testid="join-code">{joinCode || "——"}</p>
          {qr && (
            <button onClick={() => setShowQrBig(true)} className="mt-3 block rounded bg-white p-2" aria-label="放大 QR Code">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`加入教室的 QR Code，代碼 ${joinCode}`} className="h-40 w-40" data-testid="qr" />
            </button>
          )}
          <p className="mt-2 break-all text-xs opacity-70">{joinUrl}</p>
          <p className="mt-1 text-xs opacity-70">有效到 {new Date(state.expiresAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">線上學生 <span data-testid="online-count">{members.length}</span> 人</h2>
            <span className={`text-xs ${conn === "online" ? "text-emerald-700" : "text-amber-700"}`}>{conn === "online" ? "● 頻道已連線" : "● 連線中…"}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500" data-testid="synced-count">已同步到最新指令：{synced} / {members.length}</p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm" data-testid="roster">
            {members.length === 0 && <li className="text-slate-400">等待學生加入…</li>}
            {members.map((m) => (
              <li key={m.key} className="flex items-center justify-between">
                <span>{m.displayName}</span>
                <span className={`text-xs ${m.seq >= state.sequenceNumber ? "text-emerald-700" : "text-amber-600"}`}>
                  {m.seq >= state.sequenceNumber ? "✓ 已同步" : "同步中"}
                  {state.mode === "explore" && m.sceneId !== state.activeSceneId && "・自行探索中"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">只顯示暱稱；不蒐集真實姓名。</p>
        </div>
      </aside>

      {/* 右：控制台 */}
      <section className="space-y-4">
        <div className="relative h-72 overflow-hidden rounded-xl bg-black sm:h-96">
          {imageUrl && (
            <ClassroomPano ref={pano} imageUrl={imageUrl} initialView={{ yaw: scene.initialYaw, pitch: scene.initialPitch }} lookHere={state.lookHere} hotspots={scene.infoHotspots} />
          )}
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-sm text-white">
            目前：第 {sceneIndex + 1} 站 {scene.name}
          </div>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="h-6 w-6 rounded-full border-2 border-white/80" aria-hidden />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => goScene(sceneIndex - 1)} disabled={pending || sceneIndex <= 0} className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40">◀ 上一站</button>
          <button onClick={() => goScene(sceneIndex + 1)} disabled={pending || sceneIndex >= tour.scenes.length - 1} className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white disabled:opacity-40">下一站 ▶</button>
          <span className="mx-1 w-px bg-slate-300" />
          <button
            data-testid="look-here"
            onClick={() => {
              const p = pano.current?.getPosition();
              if (p) act({ type: "LOOK_HERE", target: p });
            }}
            disabled={pending}
            className="rounded-lg bg-rose-600 px-4 py-2 text-white disabled:opacity-40"
            title="把老師畫面正中央（白色圓圈）的方向傳給學生"
          >
            看這裡
          </button>
          <button onClick={() => act({ type: "LOOK_HERE", target: null })} disabled={pending || !state.lookHere} className="rounded-lg border px-4 py-2 disabled:opacity-40">解除引導</button>
        </div>

        <div className="rounded-xl border bg-white p-3">
          <p className="mb-2 text-sm font-semibold">指定場景</p>
          <ol className="flex flex-wrap gap-2">
            {tour.scenes.map((s, i) => (
              <li key={s.sceneId}>
                <button
                  onClick={() => goScene(i)}
                  disabled={pending || s.sceneId === state.activeSceneId}
                  aria-current={s.sceneId === state.activeSceneId}
                  data-testid={`scene-btn-${s.sceneId}`}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${s.sceneId === state.activeSceneId ? "border-cyan-700 bg-cyan-50 font-semibold" : "bg-white"}`}
                >
                  {i + 1}. {s.name}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-sm font-semibold">導覽模式</p>
            <div className="mt-2 flex gap-2" role="radiogroup" aria-label="導覽模式">
              <button role="radio" aria-checked={state.mode === "follow"} onClick={() => act({ type: "MODE_CHANGE", mode: "follow" })} disabled={pending || state.mode === "follow"} className={`flex-1 rounded-lg px-3 py-2 text-sm ${state.mode === "follow" ? "bg-cyan-700 text-white" : "border"}`}>
                A 跟隨導覽
              </button>
              <button role="radio" aria-checked={state.mode === "explore"} onClick={() => act({ type: "MODE_CHANGE", mode: "explore" })} disabled={pending || state.mode === "explore"} className={`flex-1 rounded-lg px-3 py-2 text-sm ${state.mode === "explore" ? "bg-emerald-700 text-white" : "border"}`}>
                B 自由探索
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">自由探索時學生可自己換場景；切回跟隨時會自動回到老師的場景。</p>
          </div>

          <div className="rounded-xl border bg-white p-3">
            <p className="text-sm font-semibold">解說卡 {state.card?.visible && <span className="ml-1 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">播放中</span>}</p>
            <input value={cardTitle} maxLength={60} onChange={(e) => setCardTitle(e.target.value)} aria-label="解說卡標題" className="mt-2 w-full rounded border px-2 py-1 text-sm" />
            <textarea value={cardText} maxLength={500} rows={2} onChange={(e) => setCardText(e.target.value)} aria-label="解說卡內容" className="mt-1 w-full rounded border px-2 py-1 text-sm" />
            <div className="mt-1 flex gap-2">
              <button onClick={() => act({ type: "SHOW_CARD", card: { visible: true, title: cardTitle, text: cardText } })} disabled={pending || !cardText.trim()} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40">▶ 播放</button>
              <button onClick={() => act({ type: "SHOW_CARD", card: { visible: false, title: cardTitle, text: cardText } })} disabled={pending || !state.card?.visible} className="rounded border px-3 py-1.5 text-sm disabled:opacity-40">❚❚ 暫停</button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            role="status"
            aria-live="polite"
            data-testid="feedback"
            className={`text-sm ${feedback?.kind === "err" ? "text-rose-700" : feedback?.kind === "ok" ? "text-emerald-700" : "text-slate-500"}`}
          >
            {feedback?.text ?? "準備好了，按「下一站」開始導覽"}
          </p>
          <button
            onClick={() => {
              if (confirm("確定要結束這堂導覽嗎？學生畫面會顯示課堂結束，代碼也會失效。")) act({ type: "SESSION_END" });
            }}
            className="rounded-lg border border-rose-300 px-4 py-2 text-rose-700"
          >
            結束課堂
          </button>
        </div>
      </section>

      {showQrBig && qr && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6" onClick={() => setShowQrBig(false)}>
          <div className="rounded-2xl bg-white p-6 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="加入教室 QR Code" className="mx-auto h-[min(70vh,70vw)] w-[min(70vh,70vw)]" />
            <p className="mt-3 font-mono text-6xl font-bold tracking-[0.2em]">{joinCode}</p>
          </div>
        </div>
      )}
    </div>
  );
}
