/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Cardboard 模式（手機模擬，mock 後端）：按鈕出現、左右分割畫面、陀螺儀轉動、老師換場景與「看這裡」在眼鏡裡也同步。
 * 用法：先啟動網站，再 `BASE_URL=http://localhost:3100 node e2e/cardboard.e2e.cjs`
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (n, ok, d = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  // 模擬器轉橫向時不會改 screen.orientation.angle，這裡假裝手機向左橫放（angle 90）
  await ctx.addInitScript(() => {
    try { Object.defineProperty(screen.orientation, "angle", { get: () => 90 }); } catch {}
  });
  const errors = [];
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/classroom/teacher`);
  await teacher.getByRole("button", { name: /建立教室/ }).click();
  await teacher.waitForSelector('[data-testid="join-code"]');
  const code = (await teacher.textContent('[data-testid="join-code"]')).trim();

  const s = await ctx.newPage();
  await s.goto(`${BASE}/classroom/join?code=${code}`);
  await s.getByPlaceholder("例如：藍鯨 07").fill("紙盒01");
  await s.getByRole("button", { name: "進入教室" }).click();
  await s.waitForSelector('[data-testid="student-room"]');
  await s.waitForSelector('[data-testid="enter-cardboard"]', { timeout: 8000 });
  check("手機上顯示「Cardboard 眼鏡模式」按鈕", true);
  check("手機上不再顯示「不支援 VR」文字", (await s.locator('[data-testid="xr-unsupported"]').count()) === 0);

  await s.setViewportSize({ width: 915, height: 412 }); // 橫放
  await s.click('[data-testid="enter-cardboard"]');
  await s.waitForSelector('[data-testid="cardboard-view"] canvas', { timeout: 8000 });
  const fire = (alpha, beta, gamma) =>
    s.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: a, beta: b, gamma: g })), [alpha, beta, gamma]);
  // 橫放（screen angle 由模擬器決定）、看正前方
  for (let i = 0; i < 5; i++) { await fire(0, 0, -90); await s.waitForTimeout(60); }
  await s.waitForTimeout(800);
  await s.screenshot({ path: path.join(OUT, "cardboard-1.png") });
  const shot = await s.screenshot();
  const same = await s.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const w = img.width / 2, y = Math.floor(img.height * 0.6);
    let diff = 0, lum = 0;
    for (let x = 10; x < w - 10; x += 7) {
      const L = g.getImageData(x, y, 1, 1).data, R = g.getImageData(x + w, y, 1, 1).data;
      diff += Math.abs(L[0] - R[0]) + Math.abs(L[1] - R[1]) + Math.abs(L[2] - R[2]); lum += L[0] + L[1] + L[2];
    }
    return { diff, lum };
  }, shot.toString("base64"));
  check("左右眼畫面相同且有畫出全景", same.lum > 1000 && same.diff < same.lum * 0.05, JSON.stringify(same));
  const warn = await s.locator("text=讀不到手機的陀螺儀").count();
  check("收到陀螺儀資料時不顯示「讀不到陀螺儀」", warn === 0);

  // 老師換場景＋看這裡
  await teacher.click('[data-testid="scene-btn-b-library"]');
  await s.waitForFunction(() => document.querySelector('[data-testid="student-room"]').getAttribute("data-scene") === "b-library");
  check("眼鏡模式中，老師換場景學生也跟著換", true);
  const lookBtn = teacher.locator('[data-testid="look-here"]');
  if (await lookBtn.count()) {
    await lookBtn.first().click();
    await s.waitForTimeout(800);
    const hint = await s.locator('[data-testid="cardboard-view"] div').allTextContents();
    check("「看這裡」提示出現在左右兩眼", hint.filter((t) => t.includes("老師")).length >= 2, hint.filter(Boolean).join(" | "));
  } else check("找到老師的「看這裡」按鈕", false);

  // 轉頭 90 度
  for (let i = 0; i < 5; i++) { await fire(90, 0, -90); await s.waitForTimeout(60); }
  await s.waitForTimeout(500);
  await s.screenshot({ path: path.join(OUT, "cardboard-2.png") });

  await s.click('[data-testid="exit-cardboard"]');
  check("可以離開眼鏡模式", (await s.locator('[data-testid="cardboard-view"]').count()) === 0);
  check("沒有 JavaScript 錯誤", errors.length === 0, errors.join("; "));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
