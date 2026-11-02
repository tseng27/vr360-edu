"use client";
/**
 * 原型階段的資料層：專案與圖片都存在瀏覽器的 IndexedDB。
 * 之後換成 Supabase 時，只需要替換這個檔案的實作，介面保持不變。
 */
import { createStore, get, set, del, keys } from "idb-keyval";
import { nanoid } from "nanoid";
import type { Project, ProjectType } from "./types";

const projectStore = () => createStore("vr360-projects", "projects");
const blobStore = () => createStore("vr360-blobs", "blobs");

export async function listProjects(): Promise<Project[]> {
  const s = projectStore();
  const ks = await keys(s);
  const all = await Promise.all(ks.map((k) => get<Project>(k, s)));
  return all.filter((p): p is Project => !!p).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return get<Project>(id, projectStore());
}

export async function saveProject(p: Project): Promise<void> {
  await set(p.id, { ...p, updatedAt: Date.now() }, projectStore());
}

export async function createProject(title: string, type: ProjectType, author: string): Promise<Project> {
  const p: Project = {
    id: nanoid(10),
    title,
    type,
    author,
    description: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scenes: [],
  };
  await saveProject(p);
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  const p = await getProject(id);
  if (p) {
    for (const s of p.scenes) {
      await deleteBlob(s.imageKey);
      await deleteBlob(s.thumbKey);
      for (const h of s.hotspots) if (h.imageKey) await deleteBlob(h.imageKey);
    }
  }
  await del(id, projectStore());
}

export async function putBlob(blob: Blob): Promise<string> {
  const key = nanoid(12);
  await set(key, blob, blobStore());
  return key;
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return get<Blob>(key, blobStore());
}

export async function deleteBlob(key: string): Promise<void> {
  urlCache.delete(key);
  await del(key, blobStore());
}

const urlCache = new Map<string, string>();
export async function blobUrl(key: string): Promise<string | undefined> {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const b = await getBlob(key);
  if (!b) return undefined;
  const url = URL.createObjectURL(b);
  urlCache.set(key, url);
  return url;
}

/* ---------- 匯出 / 匯入（沒有伺服器前，用檔案交作業） ---------- */

interface ExportFile {
  format: "vr360-edu";
  version: 1;
  project: Project;
  blobs: Record<string, string>; // key -> data URL
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

export async function exportProject(id: string): Promise<Blob> {
  const project = await getProject(id);
  if (!project) throw new Error("找不到專案");
  const blobs: Record<string, string> = {};
  const ks = new Set<string>();
  for (const s of project.scenes) {
    ks.add(s.imageKey);
    ks.add(s.thumbKey);
    for (const h of s.hotspots) if (h.imageKey) ks.add(h.imageKey);
  }
  for (const k of ks) {
    const b = await getBlob(k);
    if (b) blobs[k] = await blobToDataUrl(b);
  }
  const file: ExportFile = { format: "vr360-edu", version: 1, project, blobs };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

export async function importProject(file: File): Promise<Project> {
  const data = JSON.parse(await file.text()) as ExportFile;
  if (data.format !== "vr360-edu") throw new Error("這不是 360VR 專案檔");
  const keyMap = new Map<string, string>();
  for (const [oldKey, dataUrl] of Object.entries(data.blobs)) {
    const blob = await (await fetch(dataUrl)).blob();
    keyMap.set(oldKey, await putBlob(blob));
  }
  const remap = (k?: string) => (k ? keyMap.get(k) ?? k : k);
  const p: Project = {
    ...data.project,
    id: nanoid(10),
    scenes: data.project.scenes.map((s) => ({
      ...s,
      imageKey: remap(s.imageKey)!,
      thumbKey: remap(s.thumbKey)!,
      hotspots: s.hotspots.map((h) => ({ ...h, imageKey: remap(h.imageKey) })),
    })),
  };
  await saveProject(p);
  return p;
}
