"use client";
/**
 * 全景圖前處理：一律用 canvas 重新編碼成 JPEG。
 * 重新繪製會丟掉原檔的 EXIF（含 GPS 座標、拍攝裝置、時間），避免把學校或學生位置一起上傳。
 */

const MAX_WIDTH = 6144; // 手機 GPU 材質上限常見 8192，保守取 6144
const MAX_BYTES = 25 * 1024 * 1024;

export interface ReencodedPanorama {
  image: Blob;
  thumb: Blob;
  width: number;
  height: number;
  ratioWarning: boolean;
}

function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("圖片轉換失敗"))), "image/jpeg", quality),
  );
}

function draw(bmp: ImageBitmap, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("瀏覽器無法處理圖片");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

export async function reencodePanorama(file: Blob): Promise<ReencodedPanorama> {
  if (file.size > MAX_BYTES) throw new Error("檔案超過 25 MB，請先縮小再上傳");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("只接受 JPG / PNG / WebP 全景圖");
  const bmp = await createImageBitmap(file);
  try {
    const ratio = bmp.width / bmp.height;
    const w = Math.min(bmp.width, MAX_WIDTH);
    const h = Math.round(w / ratio);
    const image = await toJpeg(draw(bmp, w, h), 0.86);
    const thumb = await toJpeg(draw(bmp, 512, Math.round(512 / ratio)), 0.75);
    return { image, thumb, width: w, height: h, ratioWarning: Math.abs(ratio - 2) > 0.05 };
  } finally {
    bmp.close();
  }
}
