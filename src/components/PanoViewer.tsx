"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Viewer } from "@photo-sphere-viewer/core";
import type { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import { HOTSPOT_ICON, type Hotspot } from "@/lib/types";

export interface PanoViewerHandle {
  getPosition(): { yaw: number; pitch: number } | null;
}

interface Props {
  imageUrl?: string;
  hotspots: Hotspot[];
  initialView?: { yaw: number; pitch: number };
  selectedId?: string | null;
  /** 編輯模式：點全景回傳位置 */
  onPanoClick?: (pos: { yaw: number; pitch: number }) => void;
  onHotspotClick?: (id: string) => void;
  crosshair?: boolean;
  gyroscope?: boolean;
}

function markerHtml(h: Hotspot, selected: boolean) {
  const label = h.title ? `<span class="hs-label">${escapeHtml(h.title)}</span>` : "";
  return `<div class="hs hs-${h.type}${selected ? " hs-selected" : ""}"><span class="hs-icon">${HOTSPOT_ICON[h.type]}</span>${label}</div>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const PanoViewer = forwardRef<PanoViewerHandle, Props>(function PanoViewer(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markersRef = useRef<MarkersPlugin | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const loadedUrl = useRef<string | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    getPosition() {
      const v = viewerRef.current;
      if (!v) return null;
      const p = v.getPosition();
      return { yaw: p.yaw, pitch: p.pitch };
    },
  }));

  // 建立 viewer（只做一次）
  useEffect(() => {
    let destroyed = false;
    (async () => {
      const [{ Viewer }, { MarkersPlugin }, { GyroscopePlugin }] = await Promise.all([
        import("@photo-sphere-viewer/core"),
        import("@photo-sphere-viewer/markers-plugin"),
        import("@photo-sphere-viewer/gyroscope-plugin"),
      ]);
      if (destroyed || !container.current) return;
      const plugins: unknown[] = [[MarkersPlugin, {}]];
      if (propsRef.current.gyroscope) plugins.push(GyroscopePlugin);
      const viewer = new Viewer({
        container: container.current,
        panorama: propsRef.current.imageUrl,
        defaultYaw: propsRef.current.initialView?.yaw ?? 0,
        defaultPitch: propsRef.current.initialView?.pitch ?? 0,
        navbar: propsRef.current.gyroscope ? ["zoom", "move", "gyroscope", "fullscreen"] : ["zoom", "move", "fullscreen"],
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
        },
        loadingTxt: "載入中…",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: plugins as any,
      });
      loadedUrl.current = propsRef.current.imageUrl;
      viewerRef.current = viewer;
      const markers = viewer.getPlugin(MarkersPlugin) as MarkersPlugin;
      markersRef.current = markers;

      viewer.addEventListener("click", ({ data }) => {
        if (data.rightclick || (data as { marker?: unknown }).marker) return;
        propsRef.current.onPanoClick?.({ yaw: data.yaw, pitch: data.pitch });
      });
      markers.addEventListener("select-marker", ({ marker }) => {
        propsRef.current.onHotspotClick?.(marker.id);
      });
      viewer.addEventListener("ready", () => syncMarkers(), { once: true });
    })();
    return () => {
      destroyed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      markersRef.current = null;
    };
     
  }, []);

  function syncMarkers() {
    const m = markersRef.current;
    if (!m) return;
    const { hotspots, selectedId } = propsRef.current;
    m.setMarkers(
      hotspots.map((h) => ({
        id: h.id,
        position: { yaw: h.yaw, pitch: h.pitch },
        html: markerHtml(h, h.id === selectedId),
        anchor: "center center",
        size: { width: 36, height: 36 },
        zIndex: h.id === selectedId ? 20 : 10,
      })),
    );
  }

  // 換全景
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !props.imageUrl || props.imageUrl === loadedUrl.current) return;
    loadedUrl.current = props.imageUrl;
    markersRef.current?.clearMarkers();
    v.setPanorama(props.imageUrl, {
      position: props.initialView ?? { yaw: 0, pitch: 0 },
      transition: { speed: 800 },
    }).then(() => syncMarkers());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.imageUrl]);

  // 更新熱點
  useEffect(() => {
    syncMarkers();
     
  }, [props.hotspots, props.selectedId]);

  return (
    <div className={`absolute inset-0 ${props.crosshair ? "pano-crosshair" : ""}`} data-testid="pano">
      {/* PSV 會改寫容器的 class，所以給它一個 React 不會碰的內層 div */}
      <div ref={container} className="h-full w-full" />
    </div>
  );
});

export default PanoViewer;
