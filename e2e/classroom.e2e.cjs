/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 本機端到端測試（mock 後端）：一個老師分頁 + 多個學生分頁，在同一個瀏覽器裡驗證同步行為。
 * 用法：先 `npm run build && npm start -- -p 3100`，再 `BASE_URL=http://localhost:3100 npm run test:e2e`
 * 輸出：e2e/out/report.json 與截圖
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const STUDENTS = Number(process.env.STUDENTS || 10);
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function waitAttr(page, attr, value, timeout = 8000) {
  await page.waitForFunction(
    ([a, v]) => document.querySelector('[data-testid="student-room"]')?.getAttribute(a) === v,
    [attr, value],
    { timeout },
  );
}

async function joinStudent(ctx, code, name, viewport) {
  const p = await ctx.newPage();
  if (viewport) await p.setViewportSize(viewport);
  await p.goto(`${BASE}/classroom/join?code=${code}`);
  await p.getByPlaceholder("例如：藍鯨 07").fill(name);
  await p.getByRole("button", { name: "進入教室" }).click();
  await p.waitForSelector('[data-testid="student-room"]', { timeout: 15000 });
  return p;
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));

  // ---------- 老師建立教室 ----------
  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/classroom/teacher`);
  await teacher.getByRole("button", { name: /建立教室/ }).click();
  await teacher.waitForSelector('[data-testid="join-code"]');
  const code = (await teacher.textContent('[data-testid="join-code"]')).trim();
  check("老師建立教室並取得 6 碼代碼", /^[A-Z2-9]{6}$/.test(code), code);
  check("顯示 QR Code", await teacher.locator('[data-testid="qr"]').isVisible());

  // ---------- 錯誤代碼 ----------
  const bad = await ctx.newPage();
  await bad.goto(`${BASE}/classroom/join?code=ZZZZZZ`);
  await bad.getByPlaceholder("例如：藍鯨 07").fill("測試");
  await bad.getByRole("button", { name: "進入教室" }).click();
  const badMsg = await bad.locator("form p[role=alert]").textContent({ timeout: 5000 }).catch(() => "");
  check("代碼無效時顯示易懂錯誤", /找不到/.test(badMsg), badMsg);
  await bad.close();

  // ---------- 兩位學生加入（其中一位是手機尺寸） ----------
  const s1 = await joinStudent(ctx, code, "藍鯨01", { width: 390, height: 844 });
  const s2 = await joinStudent(ctx, code, "松鼠02");
  await waitAttr(s1, "data-scene", "a-field");
  await waitAttr(s2, "data-scene", "a-field");
  check("學生加入後看到第一站 A", true);

  // ---------- 老師切到場景 B ----------
  let t0 = Date.now();
  await teacher.click('[data-testid="scene-btn-b-library"]');
  await Promise.all([waitAttr(s1, "data-scene", "b-library"), waitAttr(s2, "data-scene", "b-library")]);
  check("老師按場景 B，兩位學生同步切到 B", true, `${Date.now() - t0} ms（含點擊）`);

  // ---------- 第三位學生稍晚加入 ----------
  const s3 = await joinStudent(ctx, code, "流星03");
  await waitAttr(s3, "data-scene", "b-library");
  check("稍晚加入的學生直接看到 B", true);

  // ---------- 老師名單 ----------
  await teacher.waitForFunction(() => document.querySelector('[data-testid="online-count"]')?.textContent === "3", null, { timeout: 10000 });
  check("老師看到 3 位線上學生（只有暱稱）", true, await teacher.textContent('[data-testid="roster"]'));

  // ---------- 看這裡 ----------
  const tp = teacher.locator('[data-testid="classroom-pano"]');
  const box = await tp.boundingBox();
  await teacher.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await teacher.mouse.down();
  await teacher.mouse.move(box.x + box.width / 2 - 420, box.y + box.height / 2, { steps: 12 });
  await teacher.mouse.up();
  await teacher.waitForTimeout(800);
  await teacher.click('[data-testid="look-here"]');
  await s1.waitForSelector('[data-testid="look-hint"]', { timeout: 5000 });
  await s2.waitForSelector('[data-testid="look-hint"]', { timeout: 5000 });
  const arrow = await s1.locator('[data-testid="look-edge-arrow"]').isVisible();
  check("學生看到「看這裡」方向提示與邊緣箭頭", arrow, await s1.textContent('[data-testid="look-hint"]'));
  await s1.screenshot({ path: path.join(OUT, "student-phone-look-here.png") });

  // 學生仍可自己轉頭：拖曳 s2 畫面，提示仍在、視角改變
  const sb = await s2.locator('[data-testid="classroom-pano"]').boundingBox();
  await s2.bringToFront();
  await s2.waitForTimeout(300);
  const before = await s2.textContent('[data-testid="look-hint"]');
  await s2.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await s2.mouse.down();
  await s2.mouse.move(sb.x + sb.width / 2 + 300, sb.y + sb.height / 2, { steps: 10 });
  await s2.mouse.up();
  await s2.waitForTimeout(600);
  const after = await s2.textContent('[data-testid="look-hint"]');
  check("收到提示後學生仍可自由轉頭（不鎖定視角）", before !== after, `${before} → ${after}`);

  // 學生自己按「前往老師指定方向」
  await s1.bringToFront();
  await s1.getByRole("button", { name: "前往老師指定方向" }).click();
  await s1.waitForFunction(() => !document.querySelector('[data-testid="look-edge-arrow"]'), null, { timeout: 8000 });
  check("學生自己按「前往老師指定方向」後轉到目標", true);

  // ---------- 解說卡（含 HTML 注入測試） ----------
  await teacher.getByLabel("解說卡內容").fill('<img src=x onerror="window.__xss=1">書架上有幾種顏色？');
  await teacher.getByRole("button", { name: "▶ 播放" }).click();
  await s2.waitForSelector('[data-testid="card"]', { timeout: 5000 });
  const cardText = await s2.textContent('[data-testid="card"]');
  const xss = await s2.evaluate(() => window.__xss === 1 || !!document.querySelector('[data-testid="card"] img'));
  check("解說卡同步顯示，HTML 以純文字呈現（無注入）", cardText.includes("<img") && !xss);
  await teacher.getByRole("button", { name: "❚❚ 暫停" }).click();
  await s2.waitForSelector('[data-testid="card"]', { state: "detached", timeout: 5000 });
  check("暫停解說卡後學生端收起", true);

  // ---------- 自由探索 ----------
  await teacher.getByRole("radio", { name: "B 自由探索" }).click();
  await waitAttr(s1, "data-mode", "explore");
  await s1.getByRole("button", { name: /C 美術教室/ }).click();
  await waitAttr(s1, "data-scene", "c-studio");
  const s2scene = await s2.getAttribute('[data-testid="student-room"]', "data-scene");
  check("自由探索：學生可自己切換場景，不影響其他人", s2scene === "b-library");
  await teacher.getByRole("radio", { name: "A 跟隨導覽" }).click();
  await waitAttr(s1, "data-scene", "b-library");
  check("切回跟隨模式：學生重新對齊老師場景", true);

  // ---------- 偽造事件 ----------
  const seqBefore = await s2.getAttribute('[data-testid="student-room"]', "data-seq");
  const roomId = new URL(s2.url()).searchParams.get("id");
  await s3.evaluate(([rid, seq]) => {
    const bc = new BroadcastChannel(`classroom-mock:room:${rid}`);
    const base = { v: 1, roomId: rid, sentAt: new Date().toISOString(), type: "SCENE_CHANGE", sceneId: "c-studio" };
    bc.postMessage({ kind: "event", payload: { ...base, senderRole: "student", sequenceNumber: Number(seq) + 1 } });
    bc.postMessage({ kind: "event", payload: { ...base, senderRole: "teacher", sequenceNumber: 1 } }); // 舊序號重播
    bc.postMessage({ kind: "event", payload: { ...base, senderRole: "teacher", sequenceNumber: Number(seq) + 1, sceneId: "<script>" } });
    bc.close();
  }, [roomId, seqBefore]);
  await s2.waitForTimeout(800);
  const s2after = await s2.getAttribute('[data-testid="student-room"]', "data-scene");
  check("學生端忽略 senderRole=student、舊序號重播、格式不合的偽造事件", s2after === "b-library");

  // ---------- 重新整理 ----------
  await s2.reload();
  await waitAttr(s2, "data-scene", "b-library");
  const seqReload = await s2.getAttribute('[data-testid="student-room"]', "data-seq");
  check("學生重新整理後讀到最新狀態", seqReload === seqBefore, `seq ${seqReload}`);

  // ---------- VR 按鈕 ----------
  const vrBtn = await s1.locator('[data-testid="enter-vr"]').count();
  const vrMsg = await s1.locator('[data-testid="xr-unsupported"]').textContent().catch(() => "");
  check("不支援 WebXR 的瀏覽器沒有假的「進入 VR」按鈕", vrBtn === 0 && vrMsg.length > 0, vrMsg);

  // ---------- 壓力：加到 STUDENTS 位 ----------
  const extra = [];
  for (let i = 4; i <= STUDENTS; i++) extra.push(await joinStudent(ctx, code, `學生${String(i).padStart(2, "0")}`));
  const all = [s1, s2, s3, ...extra];
  await teacher.waitForFunction((n) => document.querySelector('[data-testid="online-count"]')?.textContent === String(n), all.length, { timeout: 15000 });
  const latencies = [];
  for (const target of ["c-studio", "a-field", "b-library"]) {
    const marks = all.map((p) =>
      p.evaluate(
        (sid) =>
          new Promise((resolve) => {
            const el = document.querySelector('[data-testid="student-room"]');
            const obs = new MutationObserver(() => {
              if (el.getAttribute("data-scene") === sid) {
                obs.disconnect();
                resolve(Date.now());
              }
            });
            obs.observe(el, { attributes: true });
          }),
        target,
      ),
    );
    await teacher.waitForTimeout(200);
    t0 = Date.now();
    await teacher.click(`[data-testid="scene-btn-${target}"]`);
    const ts = await Promise.all(marks);
    latencies.push(Math.max(...ts) - t0);
  }
  await teacher.waitForFunction(() => /已同步到最新指令：(\d+) \/ \1/.test(document.querySelector('[data-testid="synced-count"]')?.textContent || ""), null, { timeout: 10000 });
  check(`${all.length} 個模擬學生分頁同時同步`, true, `最慢學生收到時間：${latencies.join(" / ")} ms（含點擊，同一台電腦）`);
  await teacher.screenshot({ path: path.join(OUT, "teacher-console.png"), fullPage: true });
  await s3.screenshot({ path: path.join(OUT, "student-desktop.png") });

  // ---------- 結束課堂 ----------
  teacher.once("dialog", (d) => d.accept());
  await teacher.getByRole("button", { name: "結束課堂" }).click();
  await s1.waitForSelector('[data-testid="session-ended"]', { timeout: 5000 });
  check("結束課堂：學生畫面顯示結束", true);
  const late = await ctx.newPage();
  await late.goto(`${BASE}/classroom/join?code=${code}`);
  await late.getByPlaceholder("例如：藍鯨 07").fill("太晚了");
  await late.getByRole("button", { name: "進入教室" }).click();
  const lateMsg = await late.locator("form p[role=alert]").textContent({ timeout: 5000 }).catch(() => "");
  check("結束後代碼失效", /找不到|結束/.test(lateMsg), lateMsg);

  check("過程中沒有未處理的頁面錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, students: all.length, latencies, results }, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
