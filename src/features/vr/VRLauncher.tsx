"use client";
/**
 * 播放器右上角的 VR 按鈕：
 * - 「VR 頭盔」：瀏覽器支援 WebXR immersive-vr 時出現（Meta Quest 瀏覽器、Android Chrome…）
 * - 「手機 VR 眼鏡」：手機 / 平板出現，左右分割畫面放進 Cardboard 類眼鏡盒（iPhone 也可以）
 * 兩種模式裡都能看熱點切換場景，或用下方導覽列「上一站 / 下一站」。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VRCard, VRSceneInput, VRTour } from "./engine";

type XRSystemLike = {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: unknown): Promise<XRSession>;
};
const xr = () => (typeof navigator === "undefined" ? undefined : (navigator as unknown as { xr?: XRSystemLike }).xr);

export interface VRLauncherProps {
  scene: VRSceneInput | null;
  card: VRCard | null;
  onHotspot(id: string): void;
  onPrev(): void;
  onNext(): void;
  /** VR 模式開關時通知（例如關掉一般畫面的說明卡） */
  onActiveChange?(active: boolean): void;
}

export default function VRLauncher(props: VRLauncherProps) {
  const [xrOk, setXrOk] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [active, setActive] = useState<null | "xr" | "cardboard">(null);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tour = useRef<VRTour | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setMobile(matchMedia("(pointer: coarse)").matches || params.has("cardboard"));
    xr()
      ?.isSessionSupported("immersive-vr")
      .then((ok) => setXrOk(ok && window.isSecureContext))
      .catch(() => {});
    return () => tour.current?.dispose();
  }, []);

  // 場景 / 說明卡變了就同步進 VR
  useEffect(() => {
    if (tour.current && props.scene) tour.current.setScene(props.scene);
  }, [props.scene]);
  useEffect(() => {
    if (!tour.current) return;
    if (props.card) tour.current.showCard(props.card);
    else tour.current.hideCard();
  }, [props.card]);

  async function makeTour() {
    const { VRTour } = await import("./engine");
    const t = new VRTour({
      onHotspot: (id) => propsRef.current.onHotspot(id),
      onPrev: () => propsRef.current.onPrev(),
      onNext: () => propsRef.current.onNext(),
      onExit: () => exit(),
    });
    if (propsRef.current.scene) t.setScene(propsRef.current.scene);
    tour.current = t;
    return t;
  }

  function finish() {
    tour.current?.dispose();
    tour.current = null;
    setActive(null);
    propsRef.current.onActiveChange?.(false);
  }

  function exit() {
    const t = tour.current;
    if (!t) return;
    const session = t.renderer.xr.getSession();
    if (session) session.end().catch(finish);
    else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      try {
        (screen.orientation as unknown as { unlock?: () => void }).unlock?.();
      } catch {}
      finish();
    }
  }

  async function enterXR() {
    setError(null);
    try {
      // requestSession 必須在按鈕點擊中呼叫，所以先要 session 再載入 Three.js
      const session = await xr()!.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
      const t = await makeTour();
      session.addEventListener("end", finish);
      await t.startXR(session);
      setActive("xr");
      propsRef.current.onActiveChange?.(true);
    } catch (e) {
      setError("無法進入 VR：" + ((e as Error).message || "裝置拒絕了請求"));
      finish();
    }
  }

  async function enterCardboard() {
    setError(null);
    // iOS 13+ 要使用者按按鈕才能讀陀螺儀；一定要在 await 其他東西之前呼叫
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    const perm = DOE?.requestPermission?.().catch(() => "denied");
    // 全螢幕 + 橫向（Android 支援；iPhone 不支援全螢幕，會用整頁覆蓋）
    const fs = document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    setActive("cardboard");
    setHint(true);
    propsRef.current.onActiveChange?.(true);
    if ((await perm) === "denied") setError("沒有取得陀螺儀權限，轉頭不會跟著動。請到 設定 > Safari 允許「動作與方向」後重新整理。");
    await fs;
    try {
      await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch {}
    const t = await makeTour();
    if (host.current) t.startCardboard(host.current);
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1.5">
        {xrOk && (
          <button data-testid="enter-xr" onClick={enterXR} className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow">
            🥽 VR 頭盔
          </button>
        )}
        {mobile && (
          <button
            data-testid="enter-cardboard"
            onClick={enterCardboard}
            className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow"
          >
            📱 手機 VR 眼鏡
          </button>
        )}
        {error && !active && <p className="max-w-[16rem] rounded bg-black/70 px-2 py-1 text-xs text-rose-200">{error}</p>}
      </div>

      {active === "cardboard" &&
        createPortal(
        <div className="fixed inset-0 bg-black" style={{ zIndex: 10000 }} data-testid="cardboard">
          <div ref={host} className="absolute inset-0" />
          {/* 中間分隔線，方便對準眼鏡盒 */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/30" />
          {hint && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-white" onClick={() => setHint(false)}>
              <div className="max-w-md space-y-3">
                <p className="text-lg font-semibold">把手機橫放進 VR 眼鏡</p>
                <p className="text-sm opacity-90">
                  轉頭環顧四周。把中間的白點對準圓形圖示 1.5 秒就會前往下一個場景或打開說明；往下看有「上一站 / 下一站 / 離開」。
                </p>
                {error && <p className="text-sm text-rose-300">{error}</p>}
                <p className="rounded bg-white/15 py-2 text-sm">點一下開始</p>
              </div>
            </div>
          )}
          <button onClick={exit} className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            離開
          </button>
        </div>,
          document.body,
        )}
    </>
  );
}
