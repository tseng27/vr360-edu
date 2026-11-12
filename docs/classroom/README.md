# 208 沉浸式探索教室（`/classroom` 模組）

老師帶領、全班同步的 360° 導覽。老師切換場景，所有學生的手機、平板或 VR 頭盔一起換；學生仍可自由轉頭。
學生不用安裝 App：掃 QR Code 或輸入 6 碼代碼就能進教室，也可以「加入主畫面」當成 App 開啟（PWA）。

> 這是既有「360 旅遊專案平台」的**獨立功能模組**，沒有改動原本的編輯器與播放器。
> 設定 `NEXT_PUBLIC_CLASSROOM_ENABLED=false` 即可整個關閉。

- [教師操作手冊](./teacher-guide.md)
- [學生操作手冊](./student-guide.md)
- [瀏覽器與 VR 裝置支援矩陣](./support-matrix.md)
- [測試紀錄與已知限制](./test-report.md)

## 目前完成度（請先看）

| 項目 | 狀態 |
| --- | --- |
| 階段一：本機離線（mock 模式，同一台電腦多個視窗） | ✅ 完成，自動化測試 21/21 通過 |
| 階段二：Supabase 資料庫、RLS、Realtime 授權 | ✅ SQL 完成，本機 PostgreSQL 權限測試通過 |
| 階段二：連上真正的 Supabase 專案、跨裝置測試 | ⛔ **尚未進行**：需要你建立 Supabase 專案（見下方步驟） |
| 階段三：WebXR VR 模式 | 🟡 程式完成；**Quest / VIVE 都還沒有實機測試** |
| 階段四：GitHub Pages | 🟡 靜態匯出與自動發佈流程完成，本機以 `/vr360-edu/` 子路徑測試通過；需要你在 GitHub 開啟 Pages（見「部署」） |
| 階段五：19 人課堂測試 | ⛔ 需校內 Wi-Fi 實測；目前只做了 10 個模擬分頁 |

## 架構

```
老師瀏覽器 ──RPC classroom_teacher_action──▶ Supabase Postgres
                                            │ 1. 確認是這間教室的老師
                                            │ 2. 鎖住房間列、序號 +1、更新狀態、寫操作紀錄
                                            │ 3. realtime.send() 廣播到私有頻道 room:<id>
學生瀏覽器 ◀──Realtime Broadcast（只能收）────┘
學生瀏覽器 ──RPC classroom_get_snapshot──▶ 加入 / 重新整理 / 重連時先讀最新狀態
```

- **控制事件只能由資料庫送出**：`realtime.messages` 的 RLS 只允許成員「收」廣播、「送」presence。
  所以學生（甚至老師的前端程式）都無法直接在頻道上送 `SCENE_CHANGE`。
- **序號**：每個事件帶 `sequenceNumber`，學生端忽略舊的、重複的事件；跳號時重新讀快照。
- **Presence** 只回報「暱稱、已同步到第幾號、在哪個場景」，不傳頭部轉向。
- **全景檢視**：沿用專案既有的 Photo Sphere Viewer；VR 模式另外用 Three.js WebXR 渲染同一張圖，共用同一份房間狀態。
- **加入代碼**只存 SHA-256 雜湊，放在沒有任何 policy 的表裡；代碼不是唯一的安全措施（另有匿名登入、成員資格、有效期限、節流）。

| 檔案 | 用途 |
| --- | --- |
| `src/features/classroom/protocol.ts` | 資料與事件型別（zod 驗證）、代碼、圖片網址白名單 |
| `src/features/classroom/reducer.ts` | 房間狀態機（老師與學生共用） |
| `src/features/classroom/backend/mock.ts` | 本機 mock 後端（localStorage + BroadcastChannel） |
| `src/features/classroom/backend/supabase.ts` | Supabase 後端（Auth + RPC + Realtime） |
| `src/app/classroom/{teacher,join,room}` | 教師端、加入頁、學生端 |
| `supabase/migrations/20261112000000_classroom.sql` | 資料表、RLS、RPC、Realtime 與 Storage 授權 |
| `supabase/tests/` | 本機資料庫權限測試 |
| `e2e/classroom.e2e.cjs` | 多分頁瀏覽器測試 |

路徑對照規格書：`/teacher` → `/classroom/teacher`、`/join` → `/classroom/join`、`/room/:id` → `/classroom/room?id=…`
（用 query string 是為了之後能做純靜態部署）。

## 本機試用（mock 模式）

```bash
npm install
npm run dev
# 視窗 1：http://localhost:3000/classroom/teacher → 建立教室
# 視窗 2、3：http://localhost:3000/classroom/join → 輸入代碼
```

Mock 模式只在**同一台電腦、同一個瀏覽器**的分頁之間同步，而且沒有真正的權限控管，只適合開發與展示。

## 啟用 Supabase（跨裝置同步）— 需要你操作

1. 到 <https://supabase.com> 建立專案（免費方案即可試用）。
2. **SQL Editor** 貼上並執行 `supabase/migrations/20261112000000_classroom.sql`
   （或用 Supabase CLI：`supabase link` 後 `supabase db push`）。
3. **Authentication → Sign In / Providers**：開啟 **Anonymous Sign-Ins**（學生用），保留 Email 登入（老師用）。
   建議同時開啟 CAPTCHA 或 Rate Limits，降低匿名帳號被濫用的風險。
4. **Realtime → Settings**：關閉「Allow public access」，只允許私有頻道。
5. **Authentication → Users → Add user** 建立老師帳號，再到 SQL Editor 把他加入教師名單：
   ```sql
   insert into public.classroom_teachers (user_id, display_name)
   select id, '王老師' from auth.users where email = 'teacher@example.edu.tw';
   ```
6. （建議）**Integrations → Cron** 啟用 pg_cron，每小時清理過期資料：
   ```sql
   select cron.schedule('classroom-cleanup', '17 * * * *', $$select public.classroom_cleanup()$$);
   ```
7. 前端環境變數（見 `classroom.env.example`）：
   ```
   NEXT_PUBLIC_CLASSROOM_BACKEND=supabase
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   **只能用 publishable（或舊版 anon）key。** 放進 secret / service_role key 時前端會拒絕啟動。

上傳的全景存放在 `classroom-panoramas` bucket（公開讀取、只有教師能寫入自己的資料夾、單檔 25 MB、只收 JPEG）。
上傳前前端會用 canvas 重新編碼，移除 EXIF（含 GPS）。

## 部署

WebXR 與手機陀螺儀都**必須 HTTPS**。

- **Vercel / Netlify / 任何支援 Next.js 的主機**：目前最直接的方式，整個專案（含原本的 360 平台）照常 `next build` 部署。
- **GitHub Pages（學生免登入）**：`.github/workflows/pages.yml` 會在每次推到 `main` 時自動靜態匯出並發佈到
  `https://<帳號>.github.io/vr360-edu/`。第一次要做一次設定：
  1. GitHub 倉庫 → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
  2. 到 **Actions** 分頁，對「Deploy to GitHub Pages」按 **Run workflow**（之後每次合併到 main 會自動更新）。
  3. 要跨裝置同步時，在 **Settings → Secrets and variables → Actions → Variables** 新增
     `CLASSROOM_BACKEND=supabase`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`（只能放 publishable key），再重跑一次 workflow。

  為了能靜態匯出，原本的編輯 / 播放頁網址從 `/edit/<id>`、`/view/<id>` 改成 `/edit?id=<id>`、`/view?id=<id>`
  （專案資料存在瀏覽器裡，不受影響；只有以前存下來的舊網址書籤會失效）。
  本機模擬：`STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/vr360-edu npm run build`，產出在 `out/`。
  GitHub Pages 只負責靜態頁面；即時同步與權限仍然由 Supabase 提供。

## 費用與額度（2026-11 參考，請以 Supabase 官方定價頁為準）

Supabase 免費方案大約包含：500 MB 資料庫、1 GB 檔案儲存、5 GB 流量、Realtime 200 個同時連線與每月 200 萬則訊息；
**一週沒有活動會自動暫停專案**（上課前要到後台喚醒，或改用付費方案）。

一堂 19 人、50 分鐘、約 100 次老師操作的課：每次操作廣播給約 20 個連線 ≈ 2,000 則訊息，加上 presence，遠低於免費額度。
最吃額度的是**全景圖流量**：一張 6144×3072 JPEG 約 2–4 MB，19 人 × 10 個場景 ≈ 0.4–0.8 GB / 堂。
建議把常用全景放在本站靜態檔（`public/classroom/…`），或先壓縮到 4096 寬。

## 測試

```bash
npm test             # 單元測試（狀態機、事件驗證、代碼、網址白名單、secret key 偵測）
npm run test:db      # 資料庫權限測試（需要本機 PostgreSQL 15+，設定 PGHOST/PGPORT/PGUSER）
npm run build && npx next start -p 3100 &
BASE_URL=http://localhost:3100 STUDENTS=10 npm run test:e2e   # 1 老師 + 10 學生分頁
```

## 測試圖片

`public/classroom/scenes/*.jpg` 由 `scripts/generate-classroom-panoramas.py` 純程式繪製（無第三方影像、無 EXIF），可自由使用。
