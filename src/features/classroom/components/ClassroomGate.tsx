"use client";
import Link from "next/link";
import { config } from "../config";

/** 模組開關與設定檢查：關閉時不載入任何教室功能 */
export default function ClassroomGate({ children }: { children: React.ReactNode }) {
  if (!config.enabled)
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p>「208 沉浸式探索教室」目前未啟用。</p>
          <Link href="/" className="mt-3 inline-block text-sky-700 underline">回首頁</Link>
        </div>
      </main>
    );
  if (config.error)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div role="alert" className="max-w-lg rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-900">
          <h1 className="text-lg font-semibold">教室設定有問題</h1>
          <p className="mt-2">{config.error}</p>
        </div>
      </main>
    );
  return <>{children}</>;
}
