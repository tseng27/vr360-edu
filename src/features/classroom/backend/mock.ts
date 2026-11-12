"use client";
/**
 * Mock 後端：用 localStorage 當「伺服器資料庫」、BroadcastChannel 當「即時頻道」。
 * 只能在「同一台電腦、同一個瀏覽器」的多個分頁 / 視窗之間同步，用於階段一離線測試。
 *
 * ⚠️ 這不是安全機制：同瀏覽器的任何分頁都能讀寫 localStorage、也能在頻道上偽造訊息。
 * 學生端仍會檢查 senderRole 與序號，但真正的權限控管在 Supabase 版（RLS + SECURITY DEFINER 函式）。
 */
import { createStore, get, set } from "idb-keyval";
import { nanoid } from "nanoid";
import { getBlob as getVr360Blob } from "@/lib/store";
import { reencodePanorama } from "../media";
import {
  NicknameSchema,
  RoomStateSchema,
  TeacherActionSchema,
  TourSchema,
  generateJoinCode,
  isValidJoinCodeFormat,
  normalizeJoinCode,
  type RoomState,
  type TeacherAction,
  type Tour,
} from "../protocol";
import { initialRoomState, reduceAction, toEvent } from "../reducer";
import {
  ClassroomError,
  type ClassroomBackend,
  type CreatedRoom,
  type PresenceMember,
  type RoomSnapshot,
  type Subscription,
} from "./types";

const P = "classroom-mock:";
const MOCK_TEACHER = { userId: "mock-teacher", label: "本機教師（mock 模式）" };
const MAX_MEMBERS = 60;

interface StoredRoom {
  state: RoomState;
  tour: Tour;
  teacherUserId: string;
  joinCode: string;
}

const blobStore = () => createStore("vr360-classroom-blobs", "blobs");

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(P + key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  localStorage.setItem(P + key, JSON.stringify(v));
}

/** 每個分頁一個匿名 userId（sessionStorage：重新整理保留、開新分頁就是新學生） */
function myUserId(): string {
  let id = sessionStorage.getItem(P + "uid");
  if (!id) {
    id = "anon-" + nanoid(10);
    sessionStorage.setItem(P + "uid", id);
  }
  return id;
}

function loadRoom(roomId: string): StoredRoom {
  const r = read<StoredRoom>("room:" + roomId);
  if (!r) throw new ClassroomError("invalid-code", "找不到這個教室");
  if (r.state.status === "open" && new Date(r.state.expiresAt) < new Date()) {
    r.state = { ...r.state, status: "ended" };
    write("room:" + roomId, r);
  }
  return r;
}

const channelName = (roomId: string) => `${P}room:${roomId}`;

type Wire =
  | { kind: "event"; payload: unknown }
  | { kind: "presence"; key: string; meta: Omit<PresenceMember, "key">; ts: number }
  | { kind: "leave"; key: string }
  | { kind: "who" };

export function createMockBackend(): ClassroomBackend {
  return {
    kind: "mock",
    async getTeacher() {
      return MOCK_TEACHER;
    },
    async teacherSignIn() {
      return MOCK_TEACHER;
    },
    async teacherSignOut() {},

    async uploadPanorama(file) {
      const { image, thumb } = await reencodePanorama(file);
      const key = nanoid(12);
      await set(key, image, blobStore());
      await set(key + "-t", thumb, blobStore());
      return { panoramaUrl: `idb:classroom:${key}`, thumbUrl: `idb:classroom:${key}-t` };
    },

    async createRoom(tourInput, ttlMinutes) {
      const tour = TourSchema.parse(tourInput);
      let joinCode = generateJoinCode();
      while (read("code:" + joinCode)) joinCode = generateJoinCode();
      const roomId = "room_" + nanoid(12);
      const state = initialRoomState(roomId, tour, new Date(Date.now() + ttlMinutes * 60_000));
      const room: StoredRoom = { state, tour, teacherUserId: MOCK_TEACHER.userId, joinCode };
      write("room:" + roomId, room);
      write("code:" + joinCode, roomId);
      write("members:" + roomId, {});
      sessionStorage.setItem(P + "teacher-of:" + roomId, "1");
      return { state, tour, joinCode };
    },

    async resumeTeacherRoom(roomId) {
      const r = read<StoredRoom>("room:" + roomId);
      if (!r || r.teacherUserId !== MOCK_TEACHER.userId) return null;
      const fresh = loadRoom(roomId);
      sessionStorage.setItem(P + "teacher-of:" + roomId, "1");
      return { state: fresh.state, tour: fresh.tour, joinCode: fresh.joinCode } satisfies CreatedRoom;
    },

    async teacherAct(roomId, actionInput: TeacherAction) {
      const action = TeacherActionSchema.parse(actionInput);
      const r = loadRoom(roomId);
      if (r.teacherUserId !== MOCK_TEACHER.userId) throw new ClassroomError("not-teacher", "只有這個教室的老師可以操作");
      if (r.state.status === "ended") throw new ClassroomError("ended", "教室已結束");
      const next = reduceAction(r.state, action, r.tour);
      write("room:" + roomId, { ...r, state: next });
      if (next.status === "ended") localStorage.removeItem(P + "code:" + r.joinCode);
      const bc = new BroadcastChannel(channelName(roomId));
      bc.postMessage({ kind: "event", payload: toEvent(next, action) } satisfies Wire);
      bc.close();
      return next;
    },

    async joinRoom(codeInput, nameInput) {
      const code = normalizeJoinCode(codeInput);
      if (!isValidJoinCodeFormat(code)) throw new ClassroomError("invalid-code", "代碼格式不對，應該是 6 位英文和數字");
      const name = NicknameSchema.safeParse(nameInput);
      if (!name.success) throw new ClassroomError("invalid-input", name.error.issues[0].message);
      const roomId = read<string>("code:" + code);
      if (!roomId) throw new ClassroomError("invalid-code", "找不到這個教室代碼，請再確認一次");
      const r = loadRoom(roomId);
      if (r.state.status === "ended") throw new ClassroomError("ended", "這堂導覽已經結束了");
      const members = read<Record<string, { displayName: string; joinedAt: string }>>("members:" + roomId) ?? {};
      const userId = myUserId();
      if (!members[userId] && Object.keys(members).length >= MAX_MEMBERS) throw new ClassroomError("full", "教室人數已滿");
      members[userId] = { displayName: name.data, joinedAt: members[userId]?.joinedAt ?? new Date().toISOString() };
      write("members:" + roomId, members);
      return { state: r.state, tour: r.tour, userId };
    },

    async fetchSnapshot(roomId): Promise<RoomSnapshot> {
      const r = loadRoom(roomId);
      const userId = myUserId();
      const members = read<Record<string, unknown>>("members:" + roomId) ?? {};
      const isTeacherTab = sessionStorage.getItem(P + "teacher-of:" + roomId) === "1";
      if (!members[userId] && !isTeacherTab) throw new ClassroomError("not-member", "請先輸入教室代碼加入");
      return { state: RoomStateSchema.parse(r.state), tour: r.tour };
    },

    subscribe(roomId, handlers, me): Subscription {
      const key = nanoid(8);
      let meta = me;
      const others = new Map<string, { m: PresenceMember; ts: number }>();
      const bc = new BroadcastChannel(channelName(roomId));
      const emitPresence = () => {
        const list = [{ ...meta, key }, ...[...others.values()].map((o) => o.m)];
        handlers.onPresence?.(list);
      };
      const announce = () => bc.postMessage({ kind: "presence", key, meta, ts: Date.now() } satisfies Wire);
      bc.onmessage = (e: MessageEvent<Wire>) => {
        const msg = e.data;
        if (msg.kind === "event") handlers.onEvent(msg.payload);
        else if (msg.kind === "presence") {
          others.set(msg.key, { m: { ...msg.meta, key: msg.key }, ts: Date.now() });
          emitPresence();
        } else if (msg.kind === "leave") {
          others.delete(msg.key);
          emitPresence();
        } else if (msg.kind === "who") announce();
      };
      announce();
      bc.postMessage({ kind: "who" } satisfies Wire);
      handlers.onStatus?.("online");
      emitPresence();
      const heartbeat = setInterval(() => {
        announce();
        const cutoff = Date.now() - 12_000;
        let changed = false;
        for (const [k, v] of others)
          if (v.ts < cutoff) {
            others.delete(k);
            changed = true;
          }
        if (changed) emitPresence();
      }, 4000);
      const onUnload = () => bc.postMessage({ kind: "leave", key } satisfies Wire);
      window.addEventListener("pagehide", onUnload);
      return {
        updatePresence(m) {
          meta = m;
          announce();
          emitPresence();
        },
        close() {
          clearInterval(heartbeat);
          window.removeEventListener("pagehide", onUnload);
          onUnload();
          bc.close();
        },
      };
    },

    async resolveImageUrl(url) {
      const m = /^idb:(classroom|vr360):(.+)$/.exec(url);
      if (!m) return url;
      const blob = m[1] === "classroom" ? await get<Blob>(m[2], blobStore()) : await getVr360Blob(m[2]);
      if (!blob) throw new Error("這張全景圖不在這台電腦上（mock 模式只能同一個瀏覽器使用）");
      return URL.createObjectURL(blob);
    },
  };
}
