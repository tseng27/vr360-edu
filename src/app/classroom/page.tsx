"use client";
import Link from "next/link";
import BackendBadge from "@/features/classroom/components/BackendBadge";

export default function ClassroomHome() {
  return (
    <main className="min-h-screen bg-slate-900 text-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12">
        <header>
          <BackendBadge />
          <h1 className="mt-4 text-3xl font-bold">208 沉浸式探索教室</h1>
          <p className="mt-2 text-slate-300">
            老師帶領、全班同步的 360° 導覽。老師切換場景，所有同學的手機、平板或 VR 頭盔一起換；同學仍可自由轉頭探索。
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/classroom/join" className="rounded-2xl bg-cyan-600 p-6 text-left shadow-lg hover:bg-cyan-500">
            <span className="text-sm opacity-80">我是學生</span>
            <span className="mt-1 block text-2xl font-semibold">輸入教室代碼加入</span>
            <span className="mt-2 block text-sm opacity-90">不用帳號，只要取一個暱稱</span>
          </Link>
          <Link href="/classroom/teacher" className="rounded-2xl bg-slate-700 p-6 text-left shadow-lg hover:bg-slate-600">
            <span className="text-sm opacity-80">我是老師</span>
            <span className="mt-1 block text-2xl font-semibold">建立導覽教室</span>
            <span className="mt-2 block text-sm opacity-90">產生代碼與 QR Code，帶全班出發</span>
          </Link>
        </div>
        <p className="text-sm text-slate-400">
          小提醒：在手機瀏覽器選「加入主畫面」，就能像 App 一樣從桌面圖示開啟。
          <Link href="/" className="ml-2 underline">回 360 旅遊專案平台</Link>
        </p>
      </div>
    </main>
  );
}
