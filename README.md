# 360 旅遊專案平台（vr360-edu）

讓高中生用 360 全景照片製作「旅遊專案」與「藝術旅遊專案」的教學平台。

## 目前進度：第 1 步原型

- 建立專案（旅遊 / 藝術旅遊兩種範本）
- 上傳 360 全景照片（2:1 等距柱狀投影 JPG/PNG，可一次多張），自動縮圖、超過 6144 寬會自動縮小
- 熱點：場景跳轉、文字說明、圖片、藝術作品卡（作品名、藝術家、年代、賞析、作品照）
- 設定每個場景的進入視角、導覽起點、地點座標
- 導覽播放器：拖曳環顧、手機陀螺儀、場景縮圖列、熱點卡片
- 匯出 / 匯入專案檔（`.vr360.json`），在還沒有伺服器前可以用檔案交作業

- **VR 眼鏡模式**：手機放進 Cardboard 類 VR 眼鏡（iPhone / Android），或用 Meta Quest 等頭盔（WebXR）；
  在 VR 裡注視或用手把選熱點切換場景、看說明卡，往下看有「上一站 / 下一站」
- **發布到網路**：Google 帳號登入後上傳到雲端，得到網址與 QR Code，任何裝置都能開（需先設定 Supabase）

使用方式與第一次設定步驟：[docs/vr](docs/vr/README.md)

> 編輯中的專案存在瀏覽器的 IndexedDB（`src/lib/store.ts`），換電腦或清除瀏覽資料就會不見；
> 發布後的版本存在 Supabase。換電腦繼續編輯請用匯出 / 匯入專案檔。

## 208 沉浸式探索教室（老師帶領、全班同步）

老師切換場景，全班手機 / 平板 / VR 頭盔同步切換的導覽教室，路徑 `/classroom`。
獨立模組，可用 `NEXT_PUBLIC_CLASSROOM_ENABLED=false` 關閉。說明、部署與測試狀態見 [docs/classroom](docs/classroom/README.md)。

## 接下來

1. 雲端編輯（換電腦也能繼續改，不只發布）
2. 班級與作業：教師建班、邀請碼、派作業、留言評分
3. 路線地圖（Leaflet + OpenStreetMap）
4. 匯入 Google 街景下載工具的全景圖

## 開發

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
npm test        # 教室模組單元測試
npm run test:e2e:vr   # VR 模式瀏覽器測試（先開 npm run dev；BASE=網址 可改目標）
npm run test:db       # 資料庫權限測試（需要本機 PostgreSQL）
```

技術：Next.js 15、TypeScript、Tailwind CSS 4、[Photo Sphere Viewer 5](https://photo-sphere-viewer.js.org/)。
