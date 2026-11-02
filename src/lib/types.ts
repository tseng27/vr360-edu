export type ProjectType = "travel" | "art";

export type HotspotType = "scene" | "info" | "image" | "artwork";

export interface Hotspot {
  id: string;
  type: HotspotType;
  yaw: number;
  pitch: number;
  title: string;
  text?: string;
  /** 場景跳轉目標 */
  targetSceneId?: string;
  /** 圖片或作品圖（存在 IndexedDB 的 key） */
  imageKey?: string;
  /** 藝術作品卡欄位 */
  artist?: string;
  year?: string;
}

export interface Scene {
  id: string;
  name: string;
  imageKey: string;
  thumbKey: string;
  initialView: { yaw: number; pitch: number };
  lat?: number;
  lng?: number;
  hotspots: Hotspot[];
}

export interface Project {
  id: string;
  title: string;
  type: ProjectType;
  description: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  startSceneId?: string;
  scenes: Scene[];
}

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  travel: "旅遊專案",
  art: "藝術旅遊專案",
};

export const HOTSPOT_LABEL: Record<HotspotType, string> = {
  scene: "場景跳轉",
  info: "文字說明",
  image: "圖片",
  artwork: "藝術作品卡",
};

export const HOTSPOT_ICON: Record<HotspotType, string> = {
  scene: "➜",
  info: "i",
  image: "▣",
  artwork: "✦",
};
