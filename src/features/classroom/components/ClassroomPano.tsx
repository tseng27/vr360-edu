"use client";
/**
 * 教室用全景檢視器（沿用專案既有的 Photo Sphere Viewer）。
 * - 換場景：setPanorama
 * - 「看這裡」：只畫標記與方向箭頭，不會自動轉動學生的視角；學生自己按按鈕才 animate 過去
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Viewer } from "@photo-sphere-viewer/core";
import type { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import { normalizeYaw, clampPitch, toDeg, toRad, type InfoHotspot, type LookTarget } from "../protocol";

export interface ClassroomPanoHandle {
  getPosition(): LookTarget | null;
  lookAt(t: LookTarget): void;
}

interface Props {
  imageUrl?: string;
  initialView: LookTarget;
  lookHere?: LookTarget | null;
  hotspots?: InfoHotspot[];
  gyroscope?: boolean;
  onPosition?: (p: LookTarget) => void;
  onHotspot?: (h: InfoHotspot) => void;
  onLoadError?: () => void;
  onLoaded?: () => void;
}

const LOOK_ID = "__look_here__";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ClassroomPano = forwardRef<ClassroomPanoHandle, Props>(function ClassroomPano(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markersRef = useRef<MarkersPlugin | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const loadedUrl = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    getPosition() {
      const v = viewerRef.current;
      if (!v) return null;
      const p = v.getPosition();
      return { yaw: normalizeYaw(toDeg(p.yaw)), pitch: clampPitch(toDeg(p.pitch)) };
    },
    lookAt(t) {
      viewerRef.current?.animate({ yaw: toRad(t.yaw), pitch: toRad(t.pitch), speed: "6rpm" });
    },
  }));

  function syncMarkers() {
    const m = markersRef.current;
    if (!m) return;
    const { lookHere, hotspots = [] } = propsRef.current;
    const list = hotspots.map((h) => ({
      id: "hs_" + h.id,
      position: { yaw: toRad(h.yaw), pitch: toRad(h.pitch) },
      html: `<div class="hs hs-info"><span class="hs-icon">i</span><span class="hs-label">${esc(h.title)}</span></div>`,
      anchor: "center center",
      size: { width: 36, height: 36 },
      zIndex: 10,
    }));
    if (lookHere)
      list.push({
        id: LOOK_ID,
        position: { yaw: toRad(lookHere.yaw), pitch: toRad(lookHere.pitch) },
        html: `<div class="cr-look" role="img" aria-label="老師指定的方向"><span></span></div>`,
        anchor: "center center",
        size: { width: 72, height: 72 },
        zIndex: 30,
      });
    m.setMarkers(list);
  }

  useEffect(() => {
    let destroyed = false;
    (async () => {
      const [{ Viewer }, { MarkersPlugin }, { GyroscopePlugin }] = await Promise.all([
        import("@photo-sphere-viewer/core"),
        import("@photo-sphere-viewer/markers-plugin"),
        import("@photo-sphere-viewer/gyroscope-plugin"),
      ]);
      if (destroyed || !container.current) return;
      const p = propsRef.current;
      const plugins: unknown[] = [[MarkersPlugin, {}]];
      if (p.gyroscope) plugins.push([GyroscopePlugin, { touchmove: true }]);
      const viewer = new Viewer({
        container: container.current,
        panorama: p.imageUrl,
        defaultYaw: toRad(p.initialView.yaw),
        defaultPitch: toRad(p.initialView.pitch),
        navbar: p.gyroscope ? ["zoom", "gyroscope", "fullscreen"] : ["zoom", "fullscreen"],
        lang: {
          zoom: "縮放",
          zoomOut: "縮小",
          zoomIn: "放大",
          moveUp: "上",
          moveDown: "下",
          moveLeft: "左",
          moveRight: "右",
          fullscreen: "全螢幕",
          loadError: "全景圖載入失敗",
          // gyroscope plugin 的按鈕名稱
          gyroscope: "陀螺儀（轉動手機看四周）",
        } as never,
        loadingTxt: "載入中…",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: plugins as any,
      });
      loadedUrl.current = p.imageUrl;
      viewerRef.current = viewer;
      markersRef.current = viewer.getPlugin(MarkersPlugin) as MarkersPlugin;
      markersRef.current.addEventListener("select-marker", ({ marker }) => {
        const h = propsRef.current.hotspots?.find((x) => "hs_" + x.id === marker.id);
        if (h) propsRef.current.onHotspot?.(h);
      });
      let raf = 0;
      viewer.addEventListener("position-updated", ({ position }) => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() =>
          propsRef.current.onPosition?.({ yaw: normalizeYaw(toDeg(position.yaw)), pitch: clampPitch(toDeg(position.pitch)) }),
        );
      });
      viewer.addEventListener("panorama-error", () => propsRef.current.onLoadError?.());
      viewer.addEventListener(
        "ready",
        () => {
          setReady(true);
          syncMarkers();
          propsRef.current.onLoaded?.();
          const pos = viewer.getPosition();
          propsRef.current.onPosition?.({ yaw: normalizeYaw(toDeg(pos.yaw)), pitch: clampPitch(toDeg(pos.pitch)) });
        },
        { once: true },
      );
    })();
    return () => {
      destroyed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // 換場景
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || !props.imageUrl || props.imageUrl === loadedUrl.current) return;
    loadedUrl.current = props.imageUrl;
    markersRef.current?.clearMarkers();
    v.setPanorama(props.imageUrl, {
      position: { yaw: toRad(props.initialView.yaw), pitch: toRad(props.initialView.pitch) },
      transition: { speed: 600 },
    })
      .then(() => {
        syncMarkers();
        propsRef.current.onLoaded?.();
      })
      .catch(() => propsRef.current.onLoadError?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.imageUrl, ready]);

  useEffect(() => {
    syncMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lookHere?.yaw, props.lookHere?.pitch, props.lookHere === null, props.hotspots]);

  return (
    <div className="absolute inset-0" data-testid="classroom-pano">
      <div ref={container} className="h-full w-full" />
    </div>
  );
});

export default ClassroomPano;
