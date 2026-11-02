# 360 旅遊專案平台（vr360-edu）

讓高中生用 360 全景照片製作「旅遊專案」與「藝術旅遊專案」的教學平台。

## 目前進度：第 1 步原型

- 建立專案（旅遊 / 藝術旅遊兩種範本）
- 上傳 360 全景照片（2:1 等距柱狀投影 JPG/PNG，可一次多張），自動縮圖、超過 6144 寬會自動縮小
- 熱點：場景跳轉、文字說明、圖片、藝術作品卡（作品名、藝術家、年代、賞析、作品照）
- 設定每個場景的進入視角、導覽起點、地點座標
- 導覽播放器：拖曳環顧、手機陀螺儀、場景縮圖列、熱點卡片
- 匯出 / 匯入專案檔（`.vr360.json`），在還沒有伺服器前可以用檔案交作業

> 原型階段資料只存在瀏覽器的 IndexedDB（`src/lib/store.ts`），換電腦或清除瀏覽資料就會不見。
> 下一步會換成 Supabase（Google 登入、雲端資料庫與檔案儲存），屆時只需替換 `store.ts`。

## 接下來

1. Supabase：Google 帳號登入、雲端儲存、真正可分享的公開網址
2. 班級與作業：教師建班、邀請碼、派作業、留言評分
3. 路線地圖（Leaflet + OpenStreetMap）
4. VR 頭盔模式（WebXR）
5. 匯入 Google 街景下載工具的全景圖

## 開發

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
```

技術：Next.js 15、TypeScript、Tailwind CSS 4、[Photo Sphere Viewer 5](https://photo-sphere-viewer.js.org/)。
