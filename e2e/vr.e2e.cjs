/* eslint-disable @typescript-eslint/no-require-imports */
// VR 模式煙霧測試：在 IndexedDB 放一個兩場景的導覽，開啟播放器 → 手機 VR 眼鏡模式，
// 注視熱點 1.5 秒後應切換到第二個場景。用法：先 npm run dev，再 BASE=http://localhost:3000 node e2e/vr.e2e.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/");
  await page.evaluate(async () => {
    const put = (db, store, key, val) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(db);
        r.onupgradeneeded = () => r.result.createObjectStore(store);
        r.onsuccess = () => {
          const tx = r.result.transaction(store, "readwrite");
          tx.objectStore(store).put(val, key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
      });
    const blob = async (u) => (await fetch(u)).blob();
    for (const [k, u] of [
      ["imgA", "/classroom/scenes/a-field.jpg"],
      ["thA", "/classroom/scenes/a-field.thumb.jpg"],
      ["imgB", "/classroom/scenes/b-library.jpg"],
      ["thB", "/classroom/scenes/b-library.thumb.jpg"],
    ])
      await put("vr360-blobs", "blobs", k, await blob(u));
    await put("vr360-projects", "projects", "vrtest0001", {
      id: "vrtest0001",
      title: "VR 測試導覽",
      type: "travel",
      description: "",
      author: "測試",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startSceneId: "s1",
      scenes: [
        { id: "s1", name: "操場", imageKey: "imgA", thumbKey: "thA", initialView: { yaw: 0, pitch: 0 },
          hotspots: [
            { id: "h1", type: "scene", yaw: 0, pitch: 0, title: "前往 圖書館", targetSceneId: "s2" },
            { id: "h2", type: "info", yaw: 0.9, pitch: 0.1, title: "司令台", text: "這裡是每週升旗的地方。" },
          ] },
        { id: "s2", name: "圖書館", imageKey: "imgB", thumbKey: "thB", initialView: { yaw: 0, pitch: 0 },
          hotspots: [{ id: "h3", type: "artwork", yaw: -0.9, pitch: 0, title: "閱覽室壁畫", artist: "美術班", year: "2026", text: "同學共同完成的壁畫，描繪學校一百年來的樣子。" }] },
      ],
    });
  });

  await page.goto(BASE + "/view?id=vrtest0001&cardboard=1");
  await page.getByText("開始導覽").click();
  await page.getByTestId("enter-cardboard").click();
  await page.getByTestId("cardboard").waitFor();
  await page.getByText("點一下開始").click();
  await page.waitForTimeout(1000);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/cardboard-1.png" });
  // 準心預設對著 yaw 0 的「前往 圖書館」熱點 → 1.5 秒後切換
  await page.waitForFunction(() => document.body.innerText.includes("圖書館") && !document.body.innerText.match(/^操場$/m), null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/cardboard-2.png" });
  const header = await page.locator("h1 + p").first().innerText();
  if (header.trim() !== "圖書館") throw new Error("注視熱點後沒有切換場景，目前：" + header);
  // 拖曳往左看到藝術作品熱點 → 停留後打開說明卡
  const box = await page.getByTestId("cardboard").boundingBox();
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.width / 2 + 180, box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/cardboard-3.png" });
  await page.getByRole("button", { name: "離開" }).click();
  await page.getByTestId("cardboard").waitFor({ state: "detached" });
  console.log("✓ 手機 VR 眼鏡模式：注視熱點切換場景、打開說明卡、離開 VR");

  // 編輯器的「發布到網路」：沒設定 Supabase 時要說明原因，而不是壞掉
  await page.setViewportSize({ width: 1200, height: 720 });
  await page.goto(BASE + "/edit?id=vrtest0001");
  await page.getByRole("button", { name: "發布到網路" }).click();
  const dlg = page.getByRole("dialog", { name: "發布到網路" });
  await dlg.waitFor();
  const txt = await dlg.innerText();
  if (!/還沒有連上雲端|用 Google 帳號登入/.test(txt)) throw new Error("發布視窗內容不對：" + txt);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/publish.png" });
  console.log("✓ 發布視窗：" + (txt.includes("Google") ? "顯示 Google 登入" : "未設定雲端時顯示說明"));

  await page.setViewportSize({ width: 412, height: 860 });
  await page.goto(BASE + "/view?id=vrtest0001&cardboard=1");
  await page.getByText("開始導覽").click();
  await page.waitForTimeout(2000);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/view-mobile.png" });
  if (errors.length) throw new Error("頁面錯誤：" + errors.join("\n"));
  await browser.close();
})().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
