import type { Metadata, Viewport } from "next";
import ClassroomGate from "@/features/classroom/components/ClassroomGate";
import "@/features/classroom/classroom.css";

const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "208 沉浸式探索教室",
  description: "老師帶領、全班同步的 360° 校園導覽",
  manifest: `${base}/classroom/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "探索教室", statusBarStyle: "black-translucent" },
  icons: { apple: `${base}/classroom/icon-192.png` },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e7490",
};

export default function ClassroomLayout({ children }: { children: React.ReactNode }) {
  return <ClassroomGate>{children}</ClassroomGate>;
}
