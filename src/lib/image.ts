"use client";

export interface ProcessedPanorama {
  image: Blob;
  thumb: Blob;
  width: number;
  height: number;
  ratioWarning: boolean;
}

/** 手機 GPU 常見上限是 8192，保守取 6144 寬，兼顧畫質與載入速度 */
const MAX_WIDTH = 6144;

async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function canvasToBlob(c: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("圖片轉換失敗"))), "image/jpeg", quality),
  );
}

function draw(bmp: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

/** 處理 360 全景：縮到合理尺寸、產生縮圖、檢查是否為 2:1 */
export async function processPanorama(file: File): Promise<ProcessedPanorama> {
  const bmp = await loadBitmap(file);
  const ratio = bmp.width / bmp.height;
  const ratioWarning = Math.abs(ratio - 2) > 0.05;
  const w = Math.min(bmp.width, MAX_WIDTH);
  const h = Math.round(w / ratio);
  const image = w === bmp.width && file.type === "image/jpeg" ? file : await canvasToBlob(draw(bmp, w, h));
  const thumb = await canvasToBlob(draw(bmp, 480, Math.round(480 / ratio)), 0.8);
  bmp.close();
  return { image, thumb, width: w, height: h, ratioWarning };
}

/** 一般圖片（熱點用）：最長邊 1600 */
export async function processPhoto(file: File): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const blob = await canvasToBlob(draw(bmp, Math.round(bmp.width * scale), Math.round(bmp.height * scale)));
  bmp.close();
  return blob;
}
