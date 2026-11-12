"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getBackend, type CreatedRoom, type TeacherIdentity } from "@/features/classroom/backend";
import BackendBadge from "@/features/classroom/components/BackendBadge";
import { config } from "@/features/classroom/config";
import type { Tour } from "@/features/classroom/protocol";
import { loadTeacherRoom, saveTeacherRoom } from "@/features/classroom/session";
import TeacherConsole from "@/features/classroom/teacher/TeacherConsole";
import TourBuilder from "@/features/classroom/teacher/TourBuilder";

export default function TeacherPage() {
  const backend = getBackend();
  const [teacher, setTeacher] = useState<TeacherIdentity | null | undefined>(undefined);
  const [room, setRoom] = useState<CreatedRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await backend.getTeacher().catch(() => null);
      setTeacher(t);
      if (!t) return;
      // 重新整理後接回原本的教室
      const saved = loadTeacherRoom();
      if (saved) {
        const r = await backend.resumeTeacherRoom(saved.roomId).catch(() => null);
        if (r && r.state.status === "open") setRoom({ ...r, joinCode: r.joinCode || saved.joinCode });
        else saveTeacherRoom(null);
      }
    })();
  }, [backend]);

  async function create(tour: Tour, ttl: number) {
    setBusy(true);
    setError(null);
    try {
      const r = await backend.createRoom(tour, ttl);
      saveTeacherRoom({ roomId: r.state.roomId, joinCode: r.joinCode });
      setRoom(r);
      setEnded(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <Link href="/classroom" className="text-xs text-slate-500">208 沉浸式探索教室</Link>
            <h1 className="text-xl font-bold">教師控制台</h1>
          </div>
          <div className="flex items-center gap-3">
            <BackendBadge />
            {teacher && config.backend === "supabase" && (
              <button
                onClick={async () => {
                  await backend.teacherSignOut();
                  saveTeacherRoom(null);
                  setTeacher(null);
                  setRoom(null);
                }}
                className="text-sm text-slate-600 underline"
              >
                登出 {teacher.label}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {teacher === undefined && <p className="text-slate-500">確認登入狀態…</p>}
        {teacher === null && <TeacherLogin onSignedIn={setTeacher} />}
        {teacher && !room && (
          <>
            {ended && <p className="mb-4 rounded bg-emerald-50 px-3 py-2 text-emerald-800">上一堂導覽已結束。可以再建立新的教室。</p>}
            {error && <p role="alert" className="mb-4 rounded bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
            <TourBuilder onCreate={create} busy={busy} />
          </>
        )}
        {teacher && room && (
          <TeacherConsole
            key={room.state.roomId}
            roomId={room.state.roomId}
            joinCode={room.joinCode}
            tour={room.tour}
            initialState={room.state}
            teacherUserId={teacher.userId}
            onEnded={() => {
              saveTeacherRoom(null);
              setRoom(null);
              setEnded(true);
            }}
          />
        )}
      </div>
    </main>
  );
}

function TeacherLogin({ onSignedIn }: { onSignedIn: (t: TeacherIdentity) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-auto max-w-sm space-y-3 rounded-xl border bg-white p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onSignedIn(await getBackend().teacherSignIn(email, password));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">教師登入</h2>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        密碼
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="rounded border px-3 py-2" />
      </label>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <button disabled={busy} className="w-full rounded bg-cyan-700 py-2 font-semibold text-white disabled:opacity-60">{busy ? "登入中…" : "登入"}</button>
      <p className="text-xs text-slate-500">教師帳號由學校管理者在 Supabase 建立並加入教師名單；學生不需要帳號。</p>
    </form>
  );
}
