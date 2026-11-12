"use client";
import { yawDelta, type LookTarget } from "../protocol";

/**
 * 老師「看這裡」的方向提示：畫面邊緣箭頭 + 文字。
 * 只提示、不強制；學生按「前往老師指定方向」才會轉過去。
 */
export default function LookHint({
  current,
  target,
  onGo,
}: {
  current: LookTarget | null;
  target: LookTarget;
  onGo: () => void;
}) {
  const dy = current ? yawDelta(current.yaw, target.yaw) : 0;
  const dp = current ? target.pitch - current.pitch : 0;
  const inView = current !== null && Math.abs(dy) < 30 && Math.abs(dp) < 22;
  const side = dy >= 0 ? "right" : "left";
  // 指南針式的小箭頭：0° 朝上 = 正前方
  const rotate = Math.max(-180, Math.min(180, dy));

  let text = "老師指定的方向就在眼前";
  if (!inView) {
    const parts: string[] = [];
    if (Math.abs(dy) >= 15) parts.push(`向${dy > 0 ? "右" : "左"}轉約 ${Math.round(Math.abs(dy))}°`);
    if (Math.abs(dp) >= 15) parts.push(dp > 0 ? "往上看" : "往下看");
    text = parts.length ? parts.join("、") : "就在附近";
  }

  return (
    <>
      {!inView && (
        <div
          aria-hidden
          data-testid="look-edge-arrow"
          className={`cr-edge-arrow pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 ${side === "right" ? "right-2" : "left-2"}`}
        >
          {side === "right" ? "▶" : "◀"}
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        data-testid="look-hint"
        className="absolute left-1/2 top-28 z-20 flex w-max max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl bg-rose-600/90 px-3 py-2 text-sm text-white shadow-lg"
      >
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-lg transition-transform"
          style={{ transform: `rotate(${rotate}deg)` }}
        >
          ↑
        </span>
        <span className="whitespace-nowrap">
          <b>老師請你看這裡</b>
          <span className="ml-1 opacity-90">{text}</span>
        </span>
        {!inView && (
          <button onClick={onGo} className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-700">
            前往老師指定方向
          </button>
        )}
      </div>
    </>
  );
}
