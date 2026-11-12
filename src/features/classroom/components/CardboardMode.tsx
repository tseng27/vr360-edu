"use client";
/**
 * Cardboard 模式：不需要 WebXR。用 Three.js 把同一張全景畫成左右兩個畫面，
 * 再用手機陀螺儀（deviceorientation）控制視角，放進 Google Cardboard 一類的紙盒眼鏡就能看。
 *
 * - iPhone（iOS 13+）必須在按鈕點擊當下呼叫 DeviceOrientationEvent.requestPermission()
 * - Android 會嘗試全螢幕 + 鎖定橫向；iPhone 不支援網頁全螢幕，請學生自己把手機橫放
 * - 場景與「看這裡」和一般模式共用同一份房間狀態，老師換場景時眼鏡裡也會跟著換
 * - 全景照片本身是單眼影像，所以左右眼畫面相同（沒有立體深度），這是正常的
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeYaw, toDeg, toRad, yawDelta, type LookTarget } from "../protocol";

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

interface Api {
  setImage(u: string): void;
  setLook(t: LookTarget | null): void;
  stop(): void;
}

/** 只在觸控裝置（手機、平板）顯示 */
export function useCardboardAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(typeof window !== "undefined" && "DeviceOrientationEvent" in window && window.matchMedia("(pointer: coarse)").matches);
  }, []);
  return ok;
}

export default function CardboardMode({
  imageUrl,
  lookHere,
  startView,
}: {
  imageUrl?: string;
  lookHere: LookTarget | null;
  /** 進入時讓正前方對準學生目前在一般模式看的方向 */
  startView: LookTarget | null;
}) {
  const available = useCardboardAvailable();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noSensor, setNoSensor] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const hintL = useRef<HTMLDivElement>(null);
  const hintR = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const props = useRef({ imageUrl, lookHere, startView });
  props.current = { imageUrl, lookHere, startView };

  useEffect(() => {
    if (imageUrl) api.current?.setImage(imageUrl);
  }, [imageUrl]);
  useEffect(() => {
    api.current?.setLook(lookHere);
  }, [lookHere]);
  useEffect(() => () => api.current?.stop(), []);

  async function enter() {
    setError(null);
    setNoSensor(false);
    // iOS：一定要在點擊的同一個呼叫堆疊裡先要權限，不能先 await 別的東西
    const DOE = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
    const permission = DOE?.requestPermission ? DOE.requestPermission().catch(() => "denied" as const) : Promise.resolve("granted" as const);
    const fs = document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    // 被拒絕時仍然進入：畫面會顯示「讀不到陀螺儀」的說明，學生可以離開後重試
    if ((await permission) !== "granted") setError("沒有取得「動作與方向」權限，轉頭可能不會動。");
    await fs;
    try {
      await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch {
      /* iPhone 與部分瀏覽器不支援，請學生自己橫放 */
    }
    setActive(true);
  }

  // active 之後才有 host 元素，在這裡建立 Three.js
  useEffect(() => {
    if (!active || !host.current) return;
    let disposed = false;
    let wakeLock: { release(): Promise<void> } | null = null;
    const el = host.current;
    (async () => {
      const THREE = await import("three");
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setScissorTest(true);
      el.prepend(renderer.domElement);
      renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(85, 1, 0.1, 1100);
      const geo = new THREE.SphereGeometry(500, 64, 32);
      geo.scale(-1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.rotation.y = -Math.PI / 2; // 全景中央（yaw 0）對 -Z，和 VR 模式一致
      scene.add(sphere);
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(14, 20, 48),
        new THREE.MeshBasicMaterial({ color: 0xff3355, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      marker.visible = false;
      scene.add(marker);
      // 準心：幫學生知道自己正看著哪裡
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.006, 0.009, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }),
      );
      reticle.position.set(0, 0, -1);
      camera.add(reticle);
      scene.add(camera);

      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      let look: LookTarget | null = null;
      const setImage = (u: string) =>
        loader.load(u, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map?.dispose();
          mat.map = tex;
          mat.needsUpdate = true;
        });
      const setLook = (t: LookTarget | null) => {
        look = t;
        marker.visible = !!t;
        if (!t) return;
        const y = toRad(t.yaw);
        const p = toRad(t.pitch);
        marker.position.set(Math.sin(y) * Math.cos(p) * 400, Math.sin(p) * 400, -Math.cos(y) * Math.cos(p) * 400);
        marker.lookAt(0, 0, 0);
      };

      // ----- 陀螺儀 → 相機方向（同 three.js 舊版 DeviceOrientationControls 的算法）-----
      const zee = new THREE.Vector3(0, 0, 1);
      const euler = new THREE.Euler();
      const q0 = new THREE.Quaternion();
      const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // 繞 X 轉 -90°
      const qYaw = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      let latest: DeviceOrientationEvent | null = null;
      let yawOffset: number | null = null;
      const onOrient = (e: DeviceOrientationEvent) => {
        if (e.alpha === null) return;
        latest = e;
        setNoSensor(false);
      };
      window.addEventListener("deviceorientation", onOrient);
      const sensorTimer = setTimeout(() => {
        if (!latest) setNoSensor(true);
      }, 1500);

      const screenAngle = () => toRad((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number);
      const currentYawPitch = () => {
        camera.getWorldDirection(dir);
        return { yaw: normalizeYaw(toDeg(Math.atan2(dir.x, -dir.z))), pitch: toDeg(Math.asin(Math.max(-1, Math.min(1, dir.y)))) };
      };

      const resize = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / 2 / h;
        camera.updateProjectionMatrix();
      };
      resize();
      window.addEventListener("resize", resize);

      let lastHint = 0;
      const updateHint = () => {
        let text = "";
        if (look) {
          const cur = currentYawPitch();
          const dy = yawDelta(cur.yaw, look.yaw);
          const dp = look.pitch - cur.pitch;
          if (Math.abs(dy) < 25 && Math.abs(dp) < 20) text = "● 老師指定的方向就在眼前";
          else {
            const parts: string[] = [];
            if (Math.abs(dy) >= 15) parts.push(dy > 0 ? "向右轉 ▶" : "◀ 向左轉");
            if (Math.abs(dp) >= 15) parts.push(dp > 0 ? "往上看 ▲" : "往下看 ▼");
            text = "老師請你看這裡：" + (parts.join("、") || "就在附近");
          }
        }
        for (const h of [hintL.current, hintR.current]) {
          if (!h) continue;
          h.textContent = text;
          h.style.display = text ? "block" : "none";
        }
      };

      renderer.setAnimationLoop((t) => {
        if (latest) {
          euler.set(toRad(latest.beta ?? 0), toRad(latest.alpha ?? 0), -toRad(latest.gamma ?? 0), "YXZ");
          camera.quaternion.setFromEuler(euler);
          camera.quaternion.multiply(q1);
          camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle()));
          if (yawOffset === null) {
            // 第一次讀到陀螺儀：讓學生現在面對的方向 = 進入前在一般模式看的方向
            const want = props.current.startView?.yaw ?? 0;
            yawOffset = toRad(currentYawPitch().yaw - want);
          }
          camera.quaternion.premultiply(qYaw.setFromAxisAngle(yAxis, yawOffset));
        }
        const w = el.clientWidth;
        const h = el.clientHeight;
        for (const [x, vw] of [
          [0, w / 2],
          [w / 2, w / 2],
        ]) {
          renderer.setViewport(x, 0, vw, h);
          renderer.setScissor(x, 0, vw, h);
          renderer.render(scene, camera);
        }
        if (t - lastHint > 200) {
          lastHint = t;
          updateHint();
        }
      });

      if (props.current.imageUrl) setImage(props.current.imageUrl);
      setLook(props.current.lookHere);
      try {
        wakeLock = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        /* 不支援就算了 */
      }

      api.current = {
        setImage,
        setLook,
        stop() {
          clearTimeout(sensorTimer);
          window.removeEventListener("deviceorientation", onOrient);
          window.removeEventListener("resize", resize);
          renderer.setAnimationLoop(null);
          mat.map?.dispose();
          renderer.dispose();
          renderer.domElement.remove();
          api.current = null;
        },
      };
      if (disposed) api.current.stop();
    })();
    return () => {
      disposed = true;
      api.current?.stop();
      wakeLock?.release().catch(() => {});
    };
  }, [active]);

  function exit() {
    setActive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try {
      (screen.orientation as unknown as { unlock?: () => void }).unlock?.();
    } catch {
      /* ignore */
    }
  }

  if (!available) return null;

  if (!active)
    return (
      <div className="flex flex-col items-end gap-1">
        <button data-testid="enter-cardboard" onClick={enter} className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow">
          Cardboard 眼鏡模式
        </button>
        {error && <p className="max-w-[14rem] rounded bg-black/60 px-2 py-1 text-xs text-rose-200">{error}</p>}
      </div>
    );

  const hintClass =
    "pointer-events-none absolute bottom-[18%] w-[44%] -translate-x-1/2 rounded-lg bg-rose-600/90 px-2 py-1 text-center text-xs text-white";
  // 用 portal 放到 body，避免被頁面上其他圖層（提示、工具列）蓋住
  return createPortal(
    <div ref={host} data-testid="cardboard-view" className="fixed inset-0 z-50 bg-black" style={{ touchAction: "none" }}>
      {/* 中間分隔線：對準紙盒中央 */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/30" />
      <div ref={hintL} className={hintClass} style={{ left: "25%", display: "none" }} />
      <div ref={hintR} className={hintClass} style={{ left: "75%", display: "none" }} />
      {noSensor && (
        <p className="absolute inset-x-0 top-1/3 mx-auto w-fit max-w-[80%] rounded bg-black/70 px-3 py-2 text-center text-sm text-amber-200">
          讀不到手機的陀螺儀。iPhone 請離開後重按一次並選「允許」；也可以改用一般模式。
        </p>
      )}
      <p className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-[11px] text-white/60">手機橫放後放進眼鏡</p>
      <button data-testid="exit-cardboard" onClick={exit} className="absolute left-1/2 top-7 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-sm text-white">
        離開眼鏡模式
      </button>
    </div>,
    document.body,
  );
}
