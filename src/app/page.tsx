"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Thumb from "@/components/Thumb";
import { createProject, deleteProject, importProject, listProjects } from "@/lib/store";
import { PROJECT_TYPE_LABEL, type Project, type ProjectType } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [type, setType] = useState<ProjectType>("travel");
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setProjects);
  useEffect(() => {
    refresh();
    try {
      setAuthor(localStorage.getItem("vr360-author") ?? "");
    } catch {}
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      localStorage.setItem("vr360-author", author);
    } catch {}
    const p = await createProject(title.trim(), type, author.trim());
    router.push(`/edit?id=${p.id}`);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await importProject(f);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
    e.target.value = "";
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-bold">360 旅遊專案平台</h1>
          <div className="flex items-center gap-3">
            {process.env.NEXT_PUBLIC_CLASSROOM_ENABLED !== "false" && (
              <Link href="/classroom" className="rounded bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white">
                208 沉浸式探索教室
              </Link>
            )}
            <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">原型版：資料只存在這台電腦的瀏覽器</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <section className="rounded-xl border bg-white p-5">
          <h2 className="mb-4 text-lg font-semibold">建立新專案</h2>
          <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              專案名稱
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：京都古寺巡禮"
                className="rounded border px-3 py-2"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              作者（班級座號姓名）
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="例如：201 12 王小明"
                className="rounded border px-3 py-2"
              />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm">專案類型</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["travel", "art"] as ProjectType[]).map((t) => (
                  <label
                    key={t}
                    className={`cursor-pointer rounded-lg border p-3 text-sm ${type === t ? "border-sky-600 bg-sky-50" : ""}`}
                  >
                    <input type="radio" name="type" className="mr-2" checked={type === t} onChange={() => setType(t)} />
                    <b>{PROJECT_TYPE_LABEL[t]}</b>
                    <p className="mt-1 text-slate-500">
                      {t === "travel"
                        ? "規劃一條路線，在每個景點放解說與照片，串成一趟虛擬旅行。"
                        : "走進美術館、建築或街頭藝術現場，用作品卡介紹作品與藝術家。"}
                    </p>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-3 sm:col-span-2">
              <button className="rounded bg-sky-700 px-4 py-2 font-medium text-white hover:bg-sky-800">建立並開始編輯</button>
              <button type="button" onClick={() => importRef.current?.click()} className="rounded border px-4 py-2">
                匯入專案檔
              </button>
              <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
            </div>
          </form>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">我的專案</h2>
          {projects === null ? (
            <p className="text-slate-500">讀取中…</p>
          ) : projects.length === 0 ? (
            <p className="text-slate-500">還沒有專案，從上面建立第一個吧。</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => {
                const cover = p.scenes.find((s) => s.id === p.startSceneId) ?? p.scenes[0];
                return (
                  <li key={p.id} className="overflow-hidden rounded-xl border bg-white">
                    <Thumb blobKey={cover?.thumbKey} alt={p.title} className="aspect-[2/1] w-full" />
                    <div className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{PROJECT_TYPE_LABEL[p.type]}</span>
                        <span className="text-xs text-slate-500">{p.scenes.length} 個場景</span>
                      </div>
                      <h3 className="font-semibold">{p.title}</h3>
                      {p.author && <p className="text-sm text-slate-500">{p.author}</p>}
                      <div className="flex gap-2 pt-1 text-sm">
                        <Link href={`/edit?id=${p.id}`} className="rounded bg-sky-700 px-3 py-1 text-white">
                          編輯
                        </Link>
                        <Link href={`/view?id=${p.id}`} className="rounded border px-3 py-1">
                          觀看
                        </Link>
                        <button
                          onClick={async () => {
                            if (confirm(`確定刪除「${p.title}」？這無法復原。`)) {
                              await deleteProject(p.id);
                              refresh();
                            }
                          }}
                          className="ml-auto text-red-600"
                        >
                          刪除
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
