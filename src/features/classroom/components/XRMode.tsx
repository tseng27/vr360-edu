"use client";
/**
 * WebXR 沉浸模式（Three.js）。Photo Sphere Viewer 本身不支援頭盔沉浸模式，所以另外用 Three.js
 * 渲染同一張等距柱狀全景到球面；場景、「看這裡」與一般模式共用同一份房間狀態。
 *
 * - 只有在 HTTPS（secure context）+ navigator.xr.isSessionSupported('immersive-vr') 為 true 時才顯示按鈕
 * - 一定要學生自己按按鈕才 requestSession（瀏覽器也規定要使用者手勢）
 * - ⚠️ 尚未在 Quest / VIVE 實機測試
 */
import { useEffect, useRef, useState } from "react";
import type { LookTarget } from "../protocol";
import { toRad } from "../protocol";

type Support = { state: "checking" } | { state: "supported" } | { state: "unsupported"; reason: string };

interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: unknown): Promise<XRSessionLike>;
}
interface XRSessionLike extends EventTarget {
  end(): Promise<void>;
}

function xr(): XRSystemLike | undefined {
  return (navigator as unknown as { xr?: XRSystemLike }).xr;
}

export function useXRSupport(): Support {
  const [s, setS] = useState<Support>({ state: "checking" });
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!window.isSecureContext) return setS({ state: "unsupported", reason: "VR 需要 HTTPS 連線" });
      const sys = xr();
      if (!sys) return setS({ state: "unsupported", reason: "此瀏覽器不支援 VR" });
      try {
        const ok = await sys.isSessionSupported("immersive-vr");
        if (alive) setS(ok ? { state: "supported" } : { state: "unsupported", reason: "沒有偵測到 VR 頭盔" });
      } catch {
        if (alive) setS({ state: "unsupported", reason: "無法確認 VR 支援" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

export default function XRMode({
  imageUrl,
  lookHere,
  hideUnsupported = false,
}: {
  imageUrl?: string;
  lookHere: LookTarget | null;
  /** 手機上已經有 Cardboard 模式時，不必再顯示「不支援 VR」 */
  hideUnsupported?: boolean;
}) {
  const support = useXRSupport();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useRef<{ setImage(u: string): void; setLook(t: LookTarget | null): void; end(): void } | null>(null);

  useEffect(() => {
    if (imageUrl) api.current?.setImage(imageUrl);
  }, [imageUrl]);
  useEffect(() => {
    api.current?.setLook(lookHere);
  }, [lookHere]);
  useEffect(() => () => api.current?.end(), []);

  async function enter() {
    setError(null);
    const sys = xr();
    if (!sys || !imageUrl) return;
    try {
      // 必須在按鈕的 click handler 內呼叫
      const session = await sys.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
      const THREE = await import("three");
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.xr.enabled = true;
      renderer.setPixelRatio(window.devicePixelRatio);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
      const geo = new THREE.SphereGeometry(500, 64, 32);
      geo.scale(-1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const sphere = new THREE.Mesh(geo, mat);
      // 讓全景圖正中央（yaw 0）對著使用者正前方（-Z）
      sphere.rotation.y = -Math.PI / 2;
      scene.add(sphere);
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(14, 20, 48),
        new THREE.MeshBasicMaterial({ color: 0xff3355, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      marker.visible = false;
      scene.add(marker);
      const loader = new THREE.TextureLoader();
      const setImage = (u: string) =>
        loader.load(u, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map?.dispose();
          mat.map = tex;
          mat.needsUpdate = true;
        });
      const setLook = (t: LookTarget | null) => {
        marker.visible = !!t;
        if (!t) return;
        const y = toRad(t.yaw);
        const p = toRad(t.pitch);
        marker.position.set(Math.sin(y) * Math.cos(p) * 400, Math.sin(p) * 400, -Math.cos(y) * Math.cos(p) * 400);
        marker.lookAt(0, 0, 0);
      };
      setImage(imageUrl);
      setLook(lookHere);
      const end = () => {
        session.end().catch(() => {});
      };
      api.current = { setImage, setLook, end };
      session.addEventListener("end", () => {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        api.current = null;
        setActive(false);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await renderer.xr.setSession(session as any);
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      setActive(true);
    } catch (e) {
      setError("無法進入 VR：" + ((e as Error).message || "裝置拒絕了請求"));
    }
  }

  if (support.state === "checking") return null;
  if (support.state === "unsupported")
    return hideUnsupported ? null : (
      <p data-testid="xr-unsupported" className="max-w-[11rem] rounded bg-black/50 px-2 py-1 text-right text-[11px] leading-snug text-white/80">
        {support.reason}，使用一般 360° 模式
      </p>
    );
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        data-testid="enter-vr"
        onClick={active ? () => api.current?.end() : enter}
        className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow"
      >
        {active ? "離開 VR" : "進入 VR"}
      </button>
      {error && <p className="rounded bg-black/60 px-2 py-1 text-xs text-rose-200">{error}</p>}
    </div>
  );
}
