import { describe, expect, it } from "vitest";
import { looksLikeSecretKey, readConfig } from "../config";
import {
  JOIN_CODE_ALPHABET,
  NicknameSchema,
  TourSchema,
  generateJoinCode,
  isAllowedPanoramaUrl,
  isValidJoinCodeFormat,
  normalizeJoinCode,
  normalizeYaw,
  yawDelta,
} from "../protocol";
import { DEMO_TOUR } from "../demoTour";

describe("join codes", () => {
  it("generates 6 unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateJoinCode();
      expect(c).toHaveLength(6);
      expect([...c].every((ch) => JOIN_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(isValidJoinCodeFormat(c)).toBe(true);
    }
  });
  it("normalizes user input", () => {
    expect(normalizeJoinCode(" 7kq-2mx ")).toBe("7KQ2MX");
    expect(isValidJoinCodeFormat("7KQ0MX")).toBe(false); // 0 不在字母表
    expect(isValidJoinCodeFormat("<b>xx")).toBe(false);
  });
});

describe("nickname", () => {
  it("strips tags/control chars and enforces length", () => {
    expect(NicknameSchema.parse("  <b>藍鯨</b> ")).toBe("b藍鯨/b");
    expect(NicknameSchema.safeParse("   ").success).toBe(false);
    expect(NicknameSchema.safeParse("x".repeat(21)).success).toBe(false);
  });
});

describe("panorama url allow-list", () => {
  const sb = { supabaseUrl: "https://abc.supabase.co" };
  it("accepts bundled scenes and own Supabase storage", () => {
    expect(isAllowedPanoramaUrl("/classroom/scenes/a-field.jpg", {})).toBe(true);
    expect(isAllowedPanoramaUrl("https://abc.supabase.co/storage/v1/object/public/classroom-panoramas/u/x.jpg", sb)).toBe(true);
  });
  it("rejects other hosts, http, traversal, javascript: and idb outside mock", () => {
    expect(isAllowedPanoramaUrl("https://evil.example/x.jpg", sb)).toBe(false);
    expect(isAllowedPanoramaUrl("http://abc.supabase.co/storage/v1/object/public/classroom-panoramas/x.jpg", sb)).toBe(false);
    expect(isAllowedPanoramaUrl("/classroom/../secret.jpg", {})).toBe(false);
    expect(isAllowedPanoramaUrl("javascript:alert(1)", sb)).toBe(false);
    expect(isAllowedPanoramaUrl("idb:classroom:abc", {})).toBe(false);
    expect(isAllowedPanoramaUrl("idb:classroom:abc", { allowIdb: true })).toBe(true);
  });
});

describe("angles", () => {
  it("wraps yaw into -180..180", () => {
    expect(normalizeYaw(190)).toBe(-170);
    expect(normalizeYaw(-190)).toBe(170);
    expect(normalizeYaw(540)).toBe(180);
    expect(yawDelta(170, -170)).toBe(20);
    expect(yawDelta(-170, 170)).toBe(-20);
  });
});

describe("tour schema", () => {
  it("accepts the demo tour and rejects bad ids", () => {
    expect(TourSchema.safeParse(DEMO_TOUR).success).toBe(true);
    const bad = { ...DEMO_TOUR, scenes: [{ ...DEMO_TOUR.scenes[0], sceneId: "a b" }] };
    expect(TourSchema.safeParse(bad).success).toBe(false);
  });
});

describe("config", () => {
  const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.y`;
  it("detects secret / service_role keys", () => {
    expect(looksLikeSecretKey("sb_secret_abc")).toBe(true);
    expect(looksLikeSecretKey(jwt("service_role"))).toBe(true);
    expect(looksLikeSecretKey(jwt("anon"))).toBe(false);
    expect(looksLikeSecretKey("sb_publishable_abc")).toBe(false);
  });
  it("refuses to run Supabase mode with a secret key", () => {
    const cfg = readConfig({
      NEXT_PUBLIC_CLASSROOM_BACKEND: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops",
    });
    expect(cfg.error).toMatch(/secret/);
    expect(cfg.supabaseKey).toBeUndefined();
  });
  it("defaults to enabled mock mode and can be switched off", () => {
    expect(readConfig({})).toMatchObject({ enabled: true, backend: "mock" });
    expect(readConfig({ NEXT_PUBLIC_CLASSROOM_ENABLED: "false" }).enabled).toBe(false);
  });
});
