"use client";
import { useEffect, useState } from "react";
import { blobUrl } from "@/lib/store";

/** 從 IndexedDB 讀圖片的 <img> */
export default function Thumb({ blobKey, alt, className }: { blobKey?: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (blobKey) blobUrl(blobKey).then((u) => alive && setSrc(u));
    else setSrc(undefined);
    return () => {
      alive = false;
    };
  }, [blobKey]);
  if (!src) return <div className={`bg-slate-200 ${className ?? ""}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`object-cover ${className ?? ""}`} />;
}
