/**
 * 208 沉浸式探索教室：資料與事件契約（schema version 1）
 *
 * 角度一律用「度」：yaw -180~180（0 = 全景圖正中央，往右為正），pitch -90~90（往上為正）。
 * 進到 Photo Sphere Viewer / Three.js 前才換成弧度。
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

/* ---------- 基本型別 ---------- */

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "只能用英數、底線、連字號");
const safeText = (max: number) =>
  z
    .string()
    .max(max)
    // 去掉控制字元（保留換行），內容一律以純文字顯示，不會當 HTML
    .transform((s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ""));

export const YawSchema = z.number().finite().min(-180).max(180);
export const PitchSchema = z.number().finite().min(-90).max(90);

export const InfoHotspotSchema = z.object({
  id,
  yaw: YawSchema,
  pitch: PitchSchema,
  title: safeText(60),
  text: safeText(500).optional(),
});

export const SceneSchema = z.object({
  sceneId: id,
  name: safeText(40).pipe(z.string().min(1, "場景名稱不可空白")),
  intro: safeText(500).default(""),
  panoramaUrl: z.string().max(2048),
  thumbUrl: z.string().max(2048).optional(),
  initialYaw: YawSchema.default(0),
  initialPitch: PitchSchema.default(0),
  infoHotspots: z.array(InfoHotspotSchema).max(30).default([]),
  credit: safeText(200).optional(),
});

export const TourSchema = z.object({
  tourId: id,
  title: safeText(60).pipe(z.string().min(1)),
  scenes: z.array(SceneSchema).min(1, "至少需要一個場景").max(30),
});

export const RoomModeSchema = z.enum(["follow", "explore"]);
export const RoomStatusSchema = z.enum(["open", "ended"]);

export const LookTargetSchema = z.object({ yaw: YawSchema, pitch: PitchSchema });
export const CardSchema = z.object({
  visible: z.boolean(),
  title: safeText(60).default(""),
  text: safeText(500).default(""),
});

export const RoomStateSchema = z.object({
  roomId: z.string().min(1).max(64),
  tourId: id,
  activeSceneId: id,
  mode: RoomModeSchema,
  sequenceNumber: z.number().int().min(0),
  status: RoomStatusSchema,
  lookHere: LookTargetSchema.nullable(),
  card: CardSchema.nullable(),
  expiresAt: z.string(),
});

export const MembershipSchema = z.object({
  roomId: z.string(),
  userId: z.string(),
  role: z.enum(["teacher", "student"]),
  displayName: z.string(),
  joinedAt: z.string(),
});

export type InfoHotspot = z.infer<typeof InfoHotspotSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Tour = z.infer<typeof TourSchema>;
export type RoomMode = z.infer<typeof RoomModeSchema>;
export type RoomState = z.infer<typeof RoomStateSchema>;
export type LookTarget = z.infer<typeof LookTargetSchema>;
export type Card = z.infer<typeof CardSchema>;
export type Membership = z.infer<typeof MembershipSchema>;

/* ---------- 教師指令（送往後端） ---------- */

export const TeacherActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SCENE_CHANGE"), sceneId: id }),
  z.object({ type: z.literal("LOOK_HERE"), target: LookTargetSchema.nullable() }),
  z.object({ type: z.literal("MODE_CHANGE"), mode: RoomModeSchema }),
  z.object({ type: z.literal("SHOW_CARD"), card: CardSchema }),
  z.object({ type: z.literal("SESSION_END") }),
]);
export type TeacherAction = z.infer<typeof TeacherActionSchema>;
export type TeacherActionType = TeacherAction["type"];

/* ---------- 廣播事件（後端送往全班） ---------- */

export const ClassroomEventSchema = z
  .object({
    v: z.literal(SCHEMA_VERSION),
    roomId: z.string().min(1).max(64),
    sequenceNumber: z.number().int().min(1),
    sentAt: z.string(),
    senderRole: z.enum(["teacher", "student", "system"]),
  })
  .and(TeacherActionSchema);
export type ClassroomEvent = z.infer<typeof ClassroomEventSchema>;

/* ---------- 加入代碼與暱稱 ---------- */

/** 去掉容易混淆的 0/O、1/I/L */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function isValidJoinCodeFormat(code: string): boolean {
  return new RegExp(`^[${JOIN_CODE_ALPHABET}]{6,8}$`).test(code);
}

export function generateJoinCode(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  return out;
}

function defaultRandom(n: number) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export const NicknameSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001F\u007F<>]/g, "").trim())
  .pipe(z.string().min(1, "請輸入暱稱").max(20, "暱稱最多 20 個字"));

/* ---------- 場景圖片來源白名單 ---------- */

/**
 * 只接受：本站靜態檔（/classroom/…）、本機 mock 的 IndexedDB 圖（idb:…）、
 * 指定的 Supabase Storage 公開路徑（必須 https）。其他網址一律拒絕，避免 mixed content 與不明來源。
 */
export function isAllowedPanoramaUrl(url: string, opts: { supabaseUrl?: string; allowIdb?: boolean }): boolean {
  if (/^\/classroom\/[A-Za-z0-9/_.-]+\.(jpe?g|png|webp)$/i.test(url) && !url.includes("..")) return true;
  if (opts.allowIdb && /^idb:(classroom|vr360):[A-Za-z0-9_-]{1,40}$/.test(url)) return true;
  if (opts.supabaseUrl) {
    try {
      const base = new URL(opts.supabaseUrl);
      const u = new URL(url);
      return (
        u.protocol === "https:" &&
        u.host === base.host &&
        u.pathname.startsWith("/storage/v1/object/public/classroom-panoramas/") &&
        !u.pathname.includes("..")
      );
    } catch {
      return false;
    }
  }
  return false;
}

/* ---------- 角度工具 ---------- */

export function normalizeYaw(deg: number): number {
  let y = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (y === -180) y = 180;
  return Math.round(y * 10) / 10;
}

export function clampPitch(deg: number): number {
  return Math.round(Math.max(-90, Math.min(90, deg)) * 10) / 10;
}

export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

/** 從目前視角到目標的水平差（-180~180，正 = 目標在右邊） */
export function yawDelta(fromDeg: number, toDegValue: number): number {
  return normalizeYaw(toDegValue - fromDeg);
}
