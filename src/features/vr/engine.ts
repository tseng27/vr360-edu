"use client";
/**
 * 學生導覽的 VR 引擎（Three.js），兩種模式共用同一個 3D 場景：
 *
 * - "xr"：WebXR immersive-vr（Meta Quest、Android Chrome 等）。用手把射線或「注視」選擇。
 * - "cardboard"：手機放進 VR 眼鏡盒（Google Cardboard 類）。左右分割畫面 + 陀螺儀轉頭，
 *   注視熱點 1.5 秒自動觸發，或按眼鏡盒上的按鈕（等同點螢幕）。iPhone 也能用（iOS 沒有 WebXR）。
 *
 * 座標約定與 Photo Sphere Viewer 相同：yaw 0 = 全景圖正中央，往右為正；pitch 往上為正（弧度）。
 */
import * as THREE from "three";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";

export interface VRHotspot {
  id: string;
  /** scene = 跳到其他場景；其他類型 = 打開說明卡 */
  type: "scene" | "info" | "image" | "artwork";
  yaw: number;
  pitch: number;
  title: string;
  icon: string;
}

export interface VRSceneInput {
  imageUrl: string;
  name: string;
  index: number;
  total: number;
  initialYaw: number;
  hotspots: VRHotspot[];
}

export interface VRCard {
  kicker?: string;
  title: string;
  subtitle?: string;
  body?: string;
  imageUrl?: string;
}

export interface VREvents {
  onHotspot(id: string): void;
  onPrev(): void;
  onNext(): void;
  onExit(): void;
}

const SPHERE_R = 100;
const HOTSPOT_R = 7;
const DWELL_MS = 1500;
const FONT = `"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;

type Action = { kind: "hotspot"; id: string } | { kind: "prev" } | { kind: "next" } | { kind: "exit" } | { kind: "close-card" };

function dirFrom(yaw: number, pitch: number, r: number) {
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, -Math.cos(yaw) * Math.cos(pitch) * r);
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 依寬度斷行（中文逐字、英文盡量以空白斷） */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const ch of Array.from(para)) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        const sp = line.lastIndexOf(" ");
        if (/[A-Za-z0-9]/.test(ch) && sp > line.length * 0.5) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch;
        }
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

const HOTSPOT_COLOR: Record<VRHotspot["type"], string> = {
  scene: "#0ea5e9",
  info: "#f8fafc",
  image: "#a3e635",
  artwork: "#f59e0b",
};

function hotspotMesh(h: VRHotspot) {
  const tex = canvasTexture(512, 320, (ctx) => {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(256, 100, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = HOTSPOT_COLOR[h.type];
    ctx.stroke();
    ctx.fillStyle = HOTSPOT_COLOR[h.type];
    ctx.font = `bold 96px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(h.icon, 256, 104);
    if (h.title) {
      ctx.font = `bold 44px ${FONT}`;
      const label = h.title.length > 14 ? h.title.slice(0, 13) + "…" : h.title;
      const w = Math.min(500, ctx.measureText(label).width + 40);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      roundRect(ctx, 256 - w / 2, 220, w, 70, 20);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, 256, 257);
    }
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  mesh.renderOrder = 10;
  mesh.position.copy(dirFrom(h.yaw, h.pitch, HOTSPOT_R));
  mesh.lookAt(0, mesh.position.y, 0);
  mesh.userData.action = { kind: "hotspot", id: h.id } satisfies Action;
  return mesh;
}

function button(label: string, w: number, action: Action, accent = false) {
  const px = 128;
  const tex = canvasTexture(Math.round(w * px), 96, (ctx) => {
    ctx.fillStyle = accent ? "rgba(14,116,144,0.92)" : "rgba(15,23,42,0.85)";
    roundRect(ctx, 4, 4, ctx.canvas.width - 8, 88, 28);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold 44px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, ctx.canvas.width / 2, 50, ctx.canvas.width - 24);
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.2, 0.15),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  mesh.renderOrder = 20;
  mesh.userData.action = action;
  return mesh;
}

export type VRMode = "xr" | "cardboard";

export class VRTour {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);
  /** 全景 + 熱點，依場景的起始視角旋轉 */
  private content = new THREE.Group();
  private hotspots = new THREE.Group();
  private sphereMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  private nav = new THREE.Group();
  private card = new THREE.Group();
  private reticle: THREE.Group;
  private reticleRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private controllers: THREE.Group[] = [];
  private hovered: THREE.Object3D | null = null;
  private hoverStart = 0;
  private dwellEnabled = true;
  private loader = new THREE.TextureLoader();
  private imageToken = 0;
  private stereo?: StereoEffect;
  private cleanup: (() => void)[] = [];
  private mode: VRMode | null = null;
  private orientQ: THREE.Quaternion | null = null;
  private headingOffset: THREE.Quaternion | null = null;
  private dragYaw = 0;
  private dragPitch = 0;

  constructor(private events: VREvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.SphereGeometry(SPHERE_R, 96, 48);
    geo.scale(-1, 1, 1);
    const sphere = new THREE.Mesh(geo, this.sphereMat);
    sphere.rotation.y = -Math.PI / 2; // 全景圖中央（yaw 0）對著正前方 -Z
    this.content.add(sphere, this.hotspots);
    this.scene.add(this.content, this.nav, this.card, this.camera);

    // 準心：注視點 + 停留進度圈
    this.reticle = new THREE.Group();
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.reticleRing = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.042, 48, 1, 0, 0.0001),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, transparent: true }),
    );
    dot.renderOrder = this.reticleRing.renderOrder = 100;
    this.reticle.add(dot, this.reticleRing);
    this.reticle.position.set(0, 0, -1.2);
    this.camera.add(this.reticle);

    this.card.visible = false;
  }

  /* ------------------------------ 場景內容 ------------------------------ */

  setScene(s: VRSceneInput) {
    const token = ++this.imageToken;
    this.loader.load(s.imageUrl, (tex) => {
      if (token !== this.imageToken) return tex.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.sphereMat.map?.dispose();
      this.sphereMat.map = tex;
      this.sphereMat.color.set(0xffffff);
      this.sphereMat.needsUpdate = true;
    });
    this.content.rotation.y = s.initialYaw;
    this.disposeChildren(this.hotspots);
    for (const h of s.hotspots) this.hotspots.add(hotspotMesh(h));
    this.buildNav(s);
    this.hideCard();
  }

  private buildNav(s: VRSceneInput) {
    this.disposeChildren(this.nav);
    const row = new THREE.Group();
    const items: THREE.Mesh[] = [];
    if (s.total > 1) items.push(button("◀ 上一站", 2.6, { kind: "prev" }));
    const title = button(`${s.index + 1}/${s.total}　${s.name}`, 5, { kind: "next" }, true);
    title.userData.action = null; // 標題不能點
    items.push(title);
    if (s.total > 1) items.push(button("下一站 ▶", 2.6, { kind: "next" }));
    items.push(button("✕ 離開 VR", 2.6, { kind: "exit" }));
    let x = 0;
    const gap = 0.04;
    const widths = items.map((m) => (m.geometry as THREE.PlaneGeometry).parameters.width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    items.forEach((m, i) => {
      m.position.x = -total / 2 + x + widths[i] / 2;
      x += widths[i] + gap;
      row.add(m);
    });
    // 往下看約 35° 的位置
    row.position.set(0, -1.1, -1.4);
    row.lookAt(0, 0, 0);
    this.nav.add(row);
  }

  showCard(c: VRCard) {
    this.disposeChildren(this.card);
    const W = 1024;
    const draw = (img?: HTMLImageElement) =>
      canvasTexture(W, 1024, (ctx) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, 1024);
        let y = 56;
        if (img) {
          const ih = Math.min(420, (img.height / img.width) * (W - 96));
          const iw = (img.width / img.height) * ih;
          ctx.drawImage(img, (W - iw) / 2, y, iw, ih);
          y += ih + 36;
        }
        ctx.textBaseline = "top";
        if (c.kicker) {
          ctx.fillStyle = "#b45309";
          ctx.font = `bold 30px ${FONT}`;
          ctx.fillText(c.kicker, 56, y);
          y += 46;
        }
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold 60px ${FONT}`;
        for (const l of wrap(ctx, c.title, W - 112).slice(0, 2)) {
          ctx.fillText(l, 56, y);
          y += 76;
        }
        if (c.subtitle) {
          ctx.fillStyle = "#475569";
          ctx.font = `40px ${FONT}`;
          ctx.fillText(c.subtitle, 56, y + 4);
          y += 60;
        }
        if (c.body) {
          ctx.fillStyle = "#1e293b";
          ctx.font = `42px ${FONT}`;
          const lines = wrap(ctx, c.body, W - 112);
          const max = Math.floor((1024 - 60 - y - 20) / 58);
          lines.slice(0, max).forEach((l, i) => ctx.fillText(i === max - 1 && lines.length > max ? l.slice(0, -1) + "…" : l, 56, y + 20 + i * 58));
        }
      });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.4),
      new THREE.MeshBasicMaterial({ map: draw(), transparent: true, depthTest: false }),
    );
    panel.renderOrder = 30;
    panel.userData.action = { kind: "close-card" } satisfies Action;
    panel.userData.noDwell = true; // 盯著看說明不會自動關閉，要看「關閉」按鈕或按一下
    const close = button("✕ 關閉說明", 3, { kind: "close-card" }, true);
    close.position.set(0, -0.82, 0.01);
    close.renderOrder = 31;
    this.card.add(panel, close);
    if (c.imageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const mat = panel.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = draw(img);
        mat.needsUpdate = true;
      };
      img.src = c.imageUrl;
    }
    // 放在目前視線正前方（只取水平方向，避免歪斜）
    const dir = new THREE.Vector3();
    this.headCam().getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const head = new THREE.Vector3();
    this.headCam().getWorldPosition(head);
    this.card.position.copy(head).addScaledVector(dir, 1.8);
    this.card.position.y = head.y;
    this.card.lookAt(head.x, head.y, head.z);
    this.card.visible = true;
    this.hotspots.visible = false; // 說明卡打開時先藏起熱點，避免疊在卡片上
  }

  hideCard() {
    this.card.visible = false;
    this.hotspots.visible = true;
    this.disposeChildren(this.card);
  }

  /* ------------------------------ 啟動 ------------------------------ */

  async startXR(session: XRSession) {
    this.mode = "xr";
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local");
    await this.renderer.xr.setSession(session);
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -5)]),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 }),
      );
      line.visible = false;
      c.add(line);
      c.addEventListener("connected", (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        c.userData.pointer = src.targetRayMode === "tracked-pointer";
        line.visible = c.userData.pointer;
        this.updateDwell();
      });
      c.addEventListener("disconnected", () => {
        c.userData.pointer = false;
        line.visible = false;
        this.updateDwell();
      });
      c.addEventListener("select", () => {
        // 手把（tracked-pointer）用自己的射線；注視 / 螢幕點擊用頭部方向
        const hit = c.userData.pointer ? this.pick(c) : this.pick(null);
        if (hit) this.fire(hit);
      });
      this.scene.add(c);
      this.controllers.push(c);
    }
    session.addEventListener("end", () => this.dispose());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** 進入 Cardboard 模式。必須在按鈕點擊的同一個事件中呼叫（iOS 要求權限）。 */
  startCardboard(host: HTMLElement) {
    this.mode = "cardboard";
    host.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    this.stereo = new StereoEffect(this.renderer);
    this.stereo.setEyeSeparation(0.064);
    this.camera.fov = 90;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      this.camera.aspect = w / 2 / h;
      this.camera.updateProjectionMatrix();
      this.stereo!.setSize(w, h);
    };
    resize();
    window.addEventListener("resize", resize);
    this.cleanup.push(() => window.removeEventListener("resize", resize));

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      const d = THREE.MathUtils.DEG2RAD;
      const orient = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number) * d;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.beta * d, e.alpha * d, -e.gamma * d, "YXZ"));
      q.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)); // 手機背面朝前
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient));
      if (!this.headingOffset) {
        // 第一次讀到方向時，把「現在面向的方向」當成正前方
        const yaw = new THREE.Euler().setFromQuaternion(q, "YXZ").y;
        this.headingOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      }
      this.orientQ = this.headingOffset.clone().multiply(q);
    };
    window.addEventListener("deviceorientation", onOrient);
    this.cleanup.push(() => window.removeEventListener("deviceorientation", onOrient));

    // 沒有陀螺儀（電腦）時可用滑鼠拖曳；點一下 / 眼鏡盒按鈕 = 選擇準心指到的東西
    const el = this.renderer.domElement;
    let down: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY, yaw: this.dragYaw, pitch: this.dragPitch, moved: false });
    const pm = (e: PointerEvent) => {
      if (!down || this.orientQ) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) down.moved = true;
      this.dragYaw = down.yaw + dx * 0.005;
      this.dragPitch = THREE.MathUtils.clamp(down.pitch + dy * 0.005, -1.5, 1.5);
    };
    const pu = () => {
      if (down && !down.moved) {
        const hit = this.pick(null);
        if (hit) this.fire(hit);
      }
      down = null;
    };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    this.cleanup.push(() => {
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
    });

    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** 只在測試用：直接設定視角（弧度） */
  look(yaw: number, pitch: number) {
    this.dragYaw = -yaw;
    this.dragPitch = pitch;
  }

  /* ------------------------------ 每一幀 ------------------------------ */

  private headCam(): THREE.Camera {
    return this.mode === "xr" && this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
  }

  private updateDwell() {
    // 有手把射線時關閉「注視觸發」，避免環顧時誤觸
    this.dwellEnabled = !this.controllers.some((c) => c.userData.pointer);
  }

  private interactive(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    const visit = (o: THREE.Object3D) => {
      if (!o.visible) return;
      if (o.userData.action) list.push(o);
      o.children.forEach(visit);
    };
    visit(this.card.visible ? this.card : this.scene);
    if (this.card.visible) visit(this.nav);
    return list;
  }

  private pick(from: THREE.Object3D | null): THREE.Object3D | null {
    if (from) {
      const m = new THREE.Matrix4().extractRotation(from.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(from.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
    } else {
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.headCam());
    }
    const hits = this.raycaster.intersectObjects(this.interactive(), false);
    return hits[0]?.object ?? null;
  }

  private fire(o: THREE.Object3D) {
    const a = o.userData.action as Action | null;
    if (!a) return;
    this.hoverStart = performance.now() + 1e9; // 觸發後要移開視線才會再觸發
    if (a.kind === "hotspot") this.events.onHotspot(a.id);
    else if (a.kind === "prev") this.events.onPrev();
    else if (a.kind === "next") this.events.onNext();
    else if (a.kind === "close-card") this.hideCard();
    else if (a.kind === "exit") this.events.onExit();
  }

  private frame() {
    if (this.mode === "cardboard") {
      if (this.orientQ) this.camera.quaternion.copy(this.orientQ);
      else this.camera.quaternion.setFromEuler(new THREE.Euler(this.dragPitch, this.dragYaw, 0, "YXZ"));
    }
    this.scene.updateMatrixWorld();

    // 導覽列跟著頭部的水平方向慢慢轉，永遠在視線下方
    const cam = this.headCam();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    const diff = Math.atan2(Math.sin(targetYaw - this.nav.rotation.y), Math.cos(targetYaw - this.nav.rotation.y));
    // 往下看導覽列時不要追著跑
    if (dir.y > -0.35) this.nav.rotation.y += diff * 0.04;
    const head = new THREE.Vector3();
    cam.getWorldPosition(head);
    this.nav.position.copy(head);

    // 注視 / 手把 hover
    const pointer = this.controllers.find((c) => c.userData.pointer);
    const hit = pointer ? this.pick(pointer) : this.pick(null);
    const now = performance.now();
    if (hit !== this.hovered) {
      this.hovered?.scale.setScalar(1);
      this.hovered = hit;
      this.hoverStart = now;
      hit?.scale.setScalar(hit.userData.action && !hit.userData.noDwell ? 1.12 : 1);
    }
    let progress = 0;
    if (hit && this.dwellEnabled && hit.userData.action && !hit.userData.noDwell) {
      progress = Math.max(0, (now - this.hoverStart) / DWELL_MS);
      if (progress >= 1) {
        this.fire(hit);
        progress = 0;
      }
    }
    const ring = this.reticleRing.geometry as THREE.RingGeometry;
    const want = Math.max(0.0001, Math.min(progress, 1) * Math.PI * 2);
    if (Math.abs(ring.parameters.thetaLength - want) > 0.01) {
      ring.dispose();
      this.reticleRing.geometry = new THREE.RingGeometry(0.03, 0.042, 48, 1, Math.PI / 2, want);
    }
    this.reticle.visible = this.dwellEnabled;

    if (this.stereo) this.stereo.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------ 清除 ------------------------------ */

  private disposeChildren(g: THREE.Object3D) {
    for (const child of [...g.children]) {
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        mat?.map?.dispose();
        mat?.dispose();
      });
      g.remove(child);
    }
  }

  private disposed = false;
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.cleanup.forEach((f) => f());
    this.disposeChildren(this.hotspots);
    this.disposeChildren(this.nav);
    this.disposeChildren(this.card);
    this.sphereMat.map?.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
