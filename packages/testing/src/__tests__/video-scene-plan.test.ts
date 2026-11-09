import { describe, expect, test } from "bun:test";
import {
  assertAiNoticeCoversLocales,
  SCENE_TAIL_MS,
  SETUP_TOOLS,
  sceneExtensionMs,
} from "../e2e/video/scene-plan";

describe("sceneExtensionMs", () => {
  test("pads a short scene up to speech plus tail", () => {
    expect(sceneExtensionMs(1000, 3000)).toBe(3000 + SCENE_TAIL_MS - 1000);
  });

  test("leaves a scene that already outlasts speech plus tail alone", () => {
    expect(sceneExtensionMs(5000, 3000)).toBe(0);
    expect(sceneExtensionMs(3000 + SCENE_TAIL_MS, 3000)).toBe(0);
  });
});

describe("assertAiNoticeCoversLocales", () => {
  test("accepts no notice and a complete notice", () => {
    expect(() => assertAiNoticeCoversLocales(undefined, ["de", "en"])).not.toThrow();
    expect(() => assertAiNoticeCoversLocales({ de: "a", en: "b" }, ["de", "en"])).not.toThrow();
  });

  test("names the locale without notice text", () => {
    expect(() => assertAiNoticeCoversLocales({ de: "a" }, ["de", "en"])).toThrow(
      'aiNotice has no text for locale "en"',
    );
  });
});

describe("SETUP_TOOLS", () => {
  test("tools throw, so setup cannot record frames", () => {
    expect(() => SETUP_TOOLS.hold(100)).toThrow("not available in setup");
    expect(() => SETUP_TOOLS.snapshot()).toThrow("not available in setup");
    expect(() => SETUP_TOOLS.stage("<p></p>")).toThrow("not available in setup");
    expect(() => SETUP_TOOLS.animate(100)).toThrow("not available in setup");
  });
});
