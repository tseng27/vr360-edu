import { describe, expect, it } from "vitest";
import { DEMO_TOUR } from "../demoTour";
import { applyEvent, initialRoomState, reduceAction, toEvent, visibleSceneId } from "../reducer";
import type { TeacherAction } from "../protocol";

const tour = DEMO_TOUR;
const fresh = () => initialRoomState("room_1", tour, new Date(Date.now() + 3600_000));

function teacherEvent(state: ReturnType<typeof fresh>, action: TeacherAction) {
  const next = reduceAction(state, action, tour);
  return { next, evt: toEvent(next, action) };
}

describe("reducer", () => {
  it("starts on the first scene in follow mode", () => {
    const s = fresh();
    expect(s.activeSceneId).toBe("a-field");
    expect(s.mode).toBe("follow");
    expect(s.sequenceNumber).toBe(0);
  });

  it("student applies a teacher SCENE_CHANGE and ends up in the same state as the teacher", () => {
    const teacher = fresh();
    const { next, evt } = teacherEvent(teacher, { type: "SCENE_CHANGE", sceneId: "b-library" });
    const r = applyEvent(fresh(), evt, tour);
    expect(r.applied).toBe(true);
    expect(r.state).toEqual(next);
  });

  it("ignores duplicate / old events so reconnects do not switch twice", () => {
    const { evt } = teacherEvent(fresh(), { type: "SCENE_CHANGE", sceneId: "b-library" });
    const once = applyEvent(fresh(), evt, tour);
    const twice = applyEvent(once.state, evt, tour);
    expect(twice).toMatchObject({ applied: false, reason: "stale" });
  });

  it("rejects events that do not claim to come from the teacher", () => {
    const { evt } = teacherEvent(fresh(), { type: "SCENE_CHANGE", sceneId: "b-library" });
    const r = applyEvent(fresh(), { ...evt, senderRole: "student" }, tour);
    expect(r).toMatchObject({ applied: false, reason: "not-teacher" });
  });

  it("rejects malformed, other-room and unknown-scene events", () => {
    const { evt } = teacherEvent(fresh(), { type: "SCENE_CHANGE", sceneId: "b-library" });
    expect(applyEvent(fresh(), { ...evt, v: 2 }, tour)).toMatchObject({ reason: "invalid" });
    expect(applyEvent(fresh(), { ...evt, roomId: "other" }, tour)).toMatchObject({ reason: "wrong-room" });
    expect(applyEvent(fresh(), { ...evt, sceneId: "nope" }, tour)).toMatchObject({ reason: "unknown-scene" });
    expect(applyEvent(fresh(), { ...evt, sceneId: "<img src=x onerror=alert(1)>" }, tour)).toMatchObject({ reason: "invalid" });
  });

  it("flags a sequence gap so the client re-reads the stored snapshot", () => {
    let t = fresh();
    t = reduceAction(t, { type: "MODE_CHANGE", mode: "explore" }, tour); // #1 missed by the student
    const { evt } = teacherEvent(t, { type: "SCENE_CHANGE", sceneId: "c-studio" }); // #2
    const r = applyEvent(fresh(), evt, tour);
    expect(r).toMatchObject({ applied: true, gap: true });
  });

  it("LOOK_HERE stores a hint; scene change clears hint and card", () => {
    let t = reduceAction(fresh(), { type: "LOOK_HERE", target: { yaw: 120, pitch: 10 } }, tour);
    t = reduceAction(t, { type: "SHOW_CARD", card: { visible: true, title: "t", text: "x" } }, tour);
    expect(t.lookHere).toEqual({ yaw: 120, pitch: 10 });
    t = reduceAction(t, { type: "SCENE_CHANGE", sceneId: "b-library" }, tour);
    expect(t.lookHere).toBeNull();
    expect(t.card).toBeNull();
  });

  it("explore mode lets the student pick a scene; follow mode always shows the teacher's", () => {
    const t = fresh();
    expect(visibleSceneId(t, "c-studio")).toBe("a-field");
    const ex = reduceAction(t, { type: "MODE_CHANGE", mode: "explore" }, tour);
    expect(visibleSceneId(ex, "c-studio")).toBe("c-studio");
    const back = reduceAction(ex, { type: "MODE_CHANGE", mode: "follow" }, tour);
    expect(visibleSceneId(back, "c-studio")).toBe("a-field");
  });

  it("SESSION_END closes the room and later events are ignored", () => {
    const { next, evt } = teacherEvent(fresh(), { type: "SESSION_END" });
    expect(next.status).toBe("ended");
    expect(() => reduceAction(next, { type: "MODE_CHANGE", mode: "explore" }, tour)).toThrow();
    const ended = applyEvent(fresh(), evt, tour).state;
    const later = toEvent({ ...next, sequenceNumber: 2 }, { type: "MODE_CHANGE", mode: "explore" });
    expect(applyEvent(ended, later, tour)).toMatchObject({ applied: false, reason: "ended" });
  });
});
