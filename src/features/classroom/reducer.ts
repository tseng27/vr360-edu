/**
 * 房間狀態機：教師端（產生下一個狀態）與學生端（套用收到的事件）共用同一套規則。
 * 純函式、無副作用，方便單元測試；後端（SQL 函式）也照這套規則實作。
 */
import {
  ClassroomEventSchema,
  SCHEMA_VERSION,
  type ClassroomEvent,
  type RoomState,
  type TeacherAction,
  type Tour,
} from "./protocol";

export type ApplyResult =
  | { applied: true; state: RoomState; gap: boolean }
  | { applied: false; state: RoomState; reason: ApplyRejectReason };

export type ApplyRejectReason =
  | "invalid"
  | "wrong-room"
  | "not-teacher"
  | "stale"
  | "ended"
  | "unknown-scene";

/** 依教師指令計算下一個狀態（後端或 mock 後端呼叫；前端按鈕不會直接改狀態） */
export function reduceAction(state: RoomState, action: TeacherAction, tour: Tour): RoomState {
  if (state.status === "ended") throw new Error("房間已結束");
  const next: RoomState = { ...state, sequenceNumber: state.sequenceNumber + 1 };
  switch (action.type) {
    case "SCENE_CHANGE":
      if (!tour.scenes.some((s) => s.sceneId === action.sceneId)) throw new Error("找不到這個場景");
      next.activeSceneId = action.sceneId;
      // 換場景時清掉上一站的方向提示與解說卡
      next.lookHere = null;
      next.card = null;
      break;
    case "LOOK_HERE":
      next.lookHere = action.target;
      break;
    case "MODE_CHANGE":
      next.mode = action.mode;
      break;
    case "SHOW_CARD":
      next.card = action.card;
      break;
    case "SESSION_END":
      next.status = "ended";
      next.lookHere = null;
      next.card = null;
      break;
  }
  return next;
}

export function toEvent(state: RoomState, action: TeacherAction, now = new Date()): ClassroomEvent {
  return {
    v: SCHEMA_VERSION,
    roomId: state.roomId,
    sequenceNumber: state.sequenceNumber,
    sentAt: now.toISOString(),
    senderRole: "teacher",
    ...action,
  } as ClassroomEvent;
}

/**
 * 學生端套用一個收到的事件。
 * - 檢查 schema、房間、送出者角色、序號（舊的或重複的事件直接忽略）
 * - 序號跳號（gap）時仍套用，但回報 gap，呼叫端應重新讀取後端快照
 */
export function applyEvent(state: RoomState, raw: unknown, tour: Tour): ApplyResult {
  const parsed = ClassroomEventSchema.safeParse(raw);
  if (!parsed.success) return { applied: false, state, reason: "invalid" };
  const evt = parsed.data;
  if (evt.roomId !== state.roomId) return { applied: false, state, reason: "wrong-room" };
  if (evt.senderRole !== "teacher") return { applied: false, state, reason: "not-teacher" };
  if (evt.sequenceNumber <= state.sequenceNumber) return { applied: false, state, reason: "stale" };
  if (state.status === "ended") return { applied: false, state, reason: "ended" };
  if (evt.type === "SCENE_CHANGE" && !tour.scenes.some((s) => s.sceneId === evt.sceneId))
    return { applied: false, state, reason: "unknown-scene" };

  const gap = evt.sequenceNumber !== state.sequenceNumber + 1;
  const next = reduceAction({ ...state, sequenceNumber: evt.sequenceNumber - 1 }, evt, tour);
  return { applied: true, state: next, gap };
}

/** 學生在自由探索模式自行選的場景；跟隨模式一律以老師的場景為準 */
export function visibleSceneId(state: RoomState, localSceneId: string | null): string {
  if (state.mode === "explore" && localSceneId) return localSceneId;
  return state.activeSceneId;
}

export function initialRoomState(roomId: string, tour: Tour, expiresAt: Date): RoomState {
  return {
    roomId,
    tourId: tour.tourId,
    activeSceneId: tour.scenes[0].sceneId,
    mode: "follow",
    sequenceNumber: 0,
    status: "open",
    lookHere: null,
    card: null,
    expiresAt: expiresAt.toISOString(),
  };
}
