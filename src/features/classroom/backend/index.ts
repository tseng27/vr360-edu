"use client";
import { config } from "../config";
import { isAllowedPanoramaUrl, type Tour } from "../protocol";
import { createMockBackend } from "./mock";
import { createSupabaseBackend } from "./supabase";
import type { ClassroomBackend } from "./types";

let instance: ClassroomBackend | null = null;

export function getBackend(): ClassroomBackend {
  if (config.error) throw new Error(config.error);
  if (!instance) {
    instance =
      config.backend === "supabase" && config.supabaseUrl && config.supabaseKey
        ? createSupabaseBackend(config.supabaseUrl, config.supabaseKey)
        : createMockBackend();
  }
  return instance;
}

/** 前端顯示前再檢查一次每個場景的圖片來源 */
export function assertTourMediaAllowed(tour: Tour) {
  for (const s of tour.scenes) {
    const ok = isAllowedPanoramaUrl(s.panoramaUrl, {
      supabaseUrl: config.backend === "supabase" ? config.supabaseUrl : undefined,
      allowIdb: config.backend === "mock",
    });
    if (!ok) throw new Error(`場景「${s.name}」的圖片來源不在允許清單內，已拒絕載入`);
  }
}

export * from "./types";
