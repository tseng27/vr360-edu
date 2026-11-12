import type { RoomState, TeacherAction, Tour } from "../protocol";

export interface RoomSnapshot {
  state: RoomState;
  tour: Tour;
}

export interface PresenceMember {
  /** 連線 key（同一人多分頁會有多筆） */
  key: string;
  userId: string;
  role: "teacher" | "student";
  displayName: string;
  /** 學生目前已套用到的事件序號，老師用來看「同步回饋」 */
  seq: number;
  sceneId: string;
}

export type ConnectionStatus = "connecting" | "online" | "offline" | "error";

export interface SubscribeHandlers {
  onEvent(raw: unknown): void;
  onPresence?(members: PresenceMember[]): void;
  onStatus?(status: ConnectionStatus, detail?: string): void;
}

export interface Subscription {
  /** 更新自己的 presence（只在換場景或套用事件後呼叫，不高頻傳頭部轉向） */
  updatePresence(meta: Omit<PresenceMember, "key">): void;
  close(): void;
}

export interface TeacherIdentity {
  userId: string;
  label: string;
}

export interface CreatedRoom extends RoomSnapshot {
  joinCode: string;
}

export interface SavedTourSummary {
  id: string;
  title: string;
  sceneCount: number;
  updatedAt: string;
}

export interface ClassroomBackend {
  kind: "mock" | "supabase";
  /** 教師登入狀態；mock 模式會回傳一個本機教師 */
  getTeacher(): Promise<TeacherIdentity | null>;
  teacherSignIn(email: string, password: string): Promise<TeacherIdentity>;
  teacherSignOut(): Promise<void>;
  /** 教師上傳全景（會重新編碼、移除 EXIF/GPS），回傳可放進 scene.panoramaUrl 的網址 */
  uploadPanorama(file: Blob): Promise<{ panoramaUrl: string; thumbUrl: string }>;
  createRoom(tour: Tour, ttlMinutes: number): Promise<CreatedRoom>;
  /** 我的導覽：存在老師帳號下（mock 模式存在這個瀏覽器） */
  listSavedTours(): Promise<SavedTourSummary[]>;
  loadSavedTour(id: string): Promise<Tour>;
  /** id 為 null 時新增一份；回傳存檔 id */
  saveTour(tour: Tour, id: string | null): Promise<{ id: string; updatedAt: string }>;
  deleteSavedTour(id: string): Promise<void>;
  /** 教師重新整理後取回自己開著的房間 */
  resumeTeacherRoom(roomId: string): Promise<CreatedRoom | null>;
  /** 由後端分配序號、驗證教師身分，回傳新狀態並廣播給全班 */
  teacherAct(roomId: string, action: TeacherAction): Promise<RoomState>;

  /** 學生（匿名）加入：後端檢查代碼、有效期、名額，建立成員資格 */
  joinRoom(code: string, displayName: string): Promise<RoomSnapshot & { userId: string }>;
  /** 讀取後端儲存的最新房間狀態（加入、重新整理、斷線重連、序號跳號時都先讀這個） */
  fetchSnapshot(roomId: string): Promise<RoomSnapshot>;
  subscribe(roomId: string, handlers: SubscribeHandlers, me: Omit<PresenceMember, "key">): Subscription;
  /** 學生端解析圖片網址（mock 的 idb: 會轉成 blob URL） */
  resolveImageUrl(url: string): Promise<string>;
}

export class ClassroomError extends Error {
  constructor(
    public code:
      | "invalid-code"
      | "expired"
      | "ended"
      | "full"
      | "rate-limited"
      | "not-member"
      | "not-teacher"
      | "network"
      | "config"
      | "invalid-input",
    message: string,
  ) {
    super(message);
  }
}
