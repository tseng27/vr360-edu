"use client";
/**
 * Supabase 後端：Auth（老師 email 登入、學生匿名登入）+ RPC（SECURITY DEFINER）+ Realtime 私有頻道。
 * 只使用 publishable key；所有權限判斷在資料庫端（見 supabase/migrations）。
 *
 * ⚠️ 這份實作已通過型別檢查與本機資料庫權限測試，但尚未連上真正的 Supabase 專案實測。
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { reencodePanorama } from "../media";
import { RoomStateSchema, TeacherActionSchema, TourSchema, type Tour } from "../protocol";
import {
  ClassroomError,
  type ClassroomBackend,
  type CreatedRoom,
  type PresenceMember,
  type RoomSnapshot,
} from "./types";

const BUCKET = "classroom-panoramas";

type ErrCode = ClassroomError["code"];
const MESSAGES: Record<string, string> = {
  "invalid-code": "找不到這個教室代碼，請再確認一次",
  expired: "這個教室代碼已過期",
  ended: "這堂導覽已經結束了",
  full: "教室人數已滿",
  "rate-limited": "嘗試太多次了，請等幾分鐘再試",
  "not-member": "請先輸入教室代碼加入",
  "not-teacher": "這個帳號沒有教師權限（請管理者把帳號加入 classroom_teachers）",
  "invalid-input": "輸入的資料格式不正確",
};

function toError(e: { message?: string; hint?: string | null } | null | undefined, fallback = "連線失敗，請稍後再試"): ClassroomError {
  const hint = (e?.hint ?? "") as ErrCode;
  if (hint && MESSAGES[hint]) return new ClassroomError(hint, MESSAGES[hint]);
  if (e?.message && /fetch|network/i.test(e.message)) return new ClassroomError("network", "網路連線失敗，請檢查 Wi-Fi 後重試");
  return new ClassroomError("network", fallback);
}

function parseSnapshot(data: unknown): RoomSnapshot {
  const d = data as { state: unknown; tour: unknown; error?: string };
  if (d?.error) throw new ClassroomError(d.error as ErrCode, MESSAGES[d.error] ?? "加入失敗");
  return { state: RoomStateSchema.parse(d.state), tour: TourSchema.parse(d.tour) };
}

export function createSupabaseBackend(url: string, publishableKey: string): ClassroomBackend {
  const sb: SupabaseClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "classroom-auth" },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  const storagePrefix = `${url}/storage/v1/object/public/${BUCKET}/`;

  async function ensureAnonymous(): Promise<string> {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session.user.id;
    const res = await sb.auth.signInAnonymously();
    if (res.error || !res.data.user)
      throw new ClassroomError("config", "無法匿名登入：請確認 Supabase 後台已開啟 Anonymous Sign-Ins");
    return res.data.user.id;
  }

  async function teacherOrThrow() {
    const { data } = await sb.auth.getUser();
    if (!data.user || data.user.is_anonymous) throw new ClassroomError("not-teacher", "請先以教師帳號登入");
    return data.user;
  }

  return {
    kind: "supabase",

    async getTeacher() {
      const { data } = await sb.auth.getUser();
      if (!data.user || data.user.is_anonymous) return null;
      const { data: row } = await sb.from("classroom_teachers").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (!row) return null;
      return { userId: data.user.id, label: data.user.email ?? "教師" };
    },

    async teacherSignIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.user) throw new ClassroomError("not-teacher", "帳號或密碼錯誤");
      const { data: row } = await sb.from("classroom_teachers").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (!row) {
        await sb.auth.signOut();
        throw new ClassroomError("not-teacher", MESSAGES["not-teacher"]);
      }
      return { userId: data.user.id, label: data.user.email ?? "教師" };
    },

    async teacherSignOut() {
      await sb.auth.signOut();
    },

    async uploadPanorama(file) {
      const user = await teacherOrThrow();
      const { image, thumb } = await reencodePanorama(file);
      const base = `${user.id}/${nanoid(16)}`;
      for (const [path, blob] of [[`${base}.jpg`, image], [`${base}.thumb.jpg`, thumb]] as const) {
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw new ClassroomError("network", "上傳失敗：" + error.message);
      }
      return {
        panoramaUrl: sb.storage.from(BUCKET).getPublicUrl(`${base}.jpg`).data.publicUrl,
        thumbUrl: sb.storage.from(BUCKET).getPublicUrl(`${base}.thumb.jpg`).data.publicUrl,
      };
    },

    async createRoom(tourInput: Tour, ttlMinutes) {
      await teacherOrThrow();
      const tour = TourSchema.parse(tourInput);
      const { data, error } = await sb.rpc("classroom_create_room", {
        p_title: tour.title,
        p_scenes: tour.scenes,
        p_ttl_minutes: ttlMinutes,
        p_storage_prefix: storagePrefix,
      });
      if (error) throw toError(error);
      const snap = parseSnapshot(data);
      return { ...snap, joinCode: (data as { joinCode: string }).joinCode };
    },

    async listSavedTours() {
      await teacherOrThrow();
      const { data, error } = await sb
        .from("classroom_saved_tours")
        .select("id,title,scenes,updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw toError(error, "讀取「我的導覽」失敗。如果剛更新網站，請先在 Supabase 執行新的 SQL（見說明文件）。");
      return (data ?? []).map((r) => ({
        id: r.id as string,
        title: r.title as string,
        sceneCount: Array.isArray(r.scenes) ? r.scenes.length : 0,
        updatedAt: r.updated_at as string,
      }));
    },
    async loadSavedTour(id) {
      await teacherOrThrow();
      const { data, error } = await sb.from("classroom_saved_tours").select("id,title,scenes").eq("id", id).maybeSingle();
      if (error) throw toError(error);
      if (!data) throw new ClassroomError("invalid-input", "找不到這份導覽");
      return TourSchema.parse({ tourId: data.id, title: data.title, scenes: data.scenes });
    },
    async saveTour(tourInput, id) {
      await teacherOrThrow();
      const tour = TourSchema.parse(tourInput);
      const { data, error } = await sb.rpc("classroom_save_tour", {
        p_id: id,
        p_title: tour.title,
        p_scenes: tour.scenes,
        p_storage_prefix: storagePrefix,
      });
      if (error) throw toError(error, "儲存失敗。如果剛更新網站，請先在 Supabase 執行新的 SQL（見說明文件）。");
      return data as { id: string; updatedAt: string };
    },
    async deleteSavedTour(id) {
      await teacherOrThrow();
      const { error } = await sb.rpc("classroom_delete_tour", { p_id: id });
      if (error) throw toError(error);
    },

    async resumeTeacherRoom(roomId) {
      const { data, error } = await sb.rpc("classroom_teacher_snapshot", { p_room_id: roomId });
      if (error) return null;
      // 明碼代碼只在建立時回傳一次；重新整理後由頁面從 sessionStorage 補回
      return { ...parseSnapshot(data), joinCode: "" } satisfies CreatedRoom;
    },

    async teacherAct(roomId, actionInput) {
      const action = TeacherActionSchema.parse(actionInput);
      const { data, error } = await sb.rpc("classroom_teacher_action", { p_room_id: roomId, p_action: action });
      if (error) throw toError(error);
      return RoomStateSchema.parse(data);
    },

    async joinRoom(code, displayName) {
      const userId = await ensureAnonymous();
      const { data, error } = await sb.rpc("classroom_join_room", { p_code: code, p_display_name: displayName });
      if (error) throw toError(error);
      return { ...parseSnapshot(data), userId };
    },

    async fetchSnapshot(roomId) {
      const { data, error } = await sb.rpc("classroom_get_snapshot", { p_room_id: roomId });
      if (error) throw toError(error);
      return parseSnapshot(data);
    },

    subscribe(roomId, handlers, me) {
      let channel: RealtimeChannel | null = null;
      let meta = me;
      let closed = false;
      let everSubscribed = false;
      handlers.onStatus?.("connecting");

      (async () => {
        const { data } = await sb.auth.getSession();
        if (!data.session) {
          handlers.onStatus?.("error", "尚未登入");
          return;
        }
        await sb.realtime.setAuth(data.session.access_token);
        if (closed) return;
        channel = sb.channel(`room:${roomId}`, { config: { private: true, presence: { key: me.userId } } });
        channel
          .on("broadcast", { event: "classroom" }, ({ payload }) => handlers.onEvent(payload))
          .on("presence", { event: "sync" }, () => {
            const st = channel!.presenceState<Omit<PresenceMember, "key">>();
            const list: PresenceMember[] = [];
            for (const [key, metas] of Object.entries(st)) {
              const m = metas[metas.length - 1];
              if (m) list.push({ key, userId: m.userId, role: m.role, displayName: m.displayName, seq: m.seq, sceneId: m.sceneId });
            }
            handlers.onPresence?.(list);
          })
          .subscribe(async (status, err) => {
            if (status === "SUBSCRIBED") {
              // 重新連上時由頁面重新讀取快照，避免漏掉斷線期間的事件
              handlers.onStatus?.("online", everSubscribed ? "reconnected" : undefined);
              everSubscribed = true;
              await channel?.track(meta);
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              handlers.onStatus?.("offline", err?.message);
            } else if (status === "CLOSED" && !closed) {
              handlers.onStatus?.("offline");
            }
          });
      })().catch((e) => handlers.onStatus?.("error", String(e)));

      return {
        updatePresence(m) {
          meta = m;
          channel?.track(m);
        },
        close() {
          closed = true;
          if (channel) sb.removeChannel(channel);
        },
      };
    },

    async resolveImageUrl(u) {
      return u;
    },
  };
}
