"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { getBackend } from "@/features/classroom/backend";
import BackendBadge from "@/features/classroom/components/BackendBadge";
import { NicknameSchema, isValidJoinCodeFormat, normalizeJoinCode } from "@/features/classroom/protocol";
import { saveStudentSession } from "@/features/classroom/session";

const SUGGESTIONS = ["藍鯨", "松鼠", "流星", "仙人掌", "企鵝", "白雲", "海豚", "蒲公英"];

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = params.get("code");
    if (c) setCode(normalizeJoinCode(c).slice(0, 8));
    const msg = params.get("msg");
    if (msg) setError(msg);
    try {
      setName(localStorage.getItem("classroom-nickname") ?? "");
    } catch {}
  }, [params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const c = normalizeJoinCode(code);
    if (!isValidJoinCodeFormat(c)) return setError("代碼是 6 位英文字母和數字（沒有 0、O、1、I、L）");
    const n = NicknameSchema.safeParse(name);
    if (!n.success) return setError(n.error.issues[0].message);
    setBusy(true);
    try {
      const res = await getBackend().joinRoom(c, n.data);
      try {
        localStorage.setItem("classroom-nickname", n.data);
      } catch {}
      saveStudentSession({ roomId: res.state.roomId, userId: res.userId, displayName: n.data });
      router.push(`/classroom/room?id=${encodeURIComponent(res.state.roomId)}`);
    } catch (err) {
      setError((err as Error).message || "加入失敗，請再試一次");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5" noValidate>
      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-300">教室代碼</span>
        <input
          value={code}
          onChange={(e) => setCode(normalizeJoinCode(e.target.value).slice(0, 8))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="例如 7KQ2MX"
          aria-describedby="code-help"
          className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-center font-mono text-3xl tracking-[0.3em] uppercase"
        />
        <span id="code-help" className="text-xs text-slate-400">看老師螢幕上的代碼，或直接用相機掃 QR Code</span>
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-300">暱稱（不要用真實姓名）</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete="off"
          placeholder="例如：藍鯨 07"
          className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-lg"
        />
        <span className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setName(`${s}${String(Math.floor(Math.random() * 90) + 10)}`)}
              className="rounded-full bg-slate-700 px-3 py-1 text-xs"
            >
              {s}
            </button>
          ))}
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-900/60 px-4 py-3 text-rose-100">
          {error}
        </p>
      )}
      <button disabled={busy} className="rounded-xl bg-cyan-500 py-3 text-lg font-semibold text-slate-900 disabled:opacity-60">
        {busy ? "加入中…" : "進入教室"}
      </button>
      <p className="text-xs leading-relaxed text-slate-400">
        我們只會記下你的暱稱，用來讓老師知道誰在線上；不需要姓名、學號或 email。課堂結束後 24 小時內會自動刪除。
      </p>
    </form>
  );
}

export default function JoinPage() {
  return (
    <main className="min-h-screen bg-slate-900 text-white">
      <div className="mx-auto max-w-md px-5 py-10">
        <BackendBadge />
        <h1 className="mt-4 text-2xl font-bold">加入探索教室</h1>
        <Suspense fallback={<p className="mt-6 text-slate-400">載入中…</p>}>
          <JoinForm />
        </Suspense>
      </div>
    </main>
  );
}
