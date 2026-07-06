import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { CAP_COUNTER_LIST_SCREEN_ID } from "../constants";
import { capCounterFeature } from "../feature";

describe("cap-counter list screen + handler access alignment", () => {
  const features = [capCounterFeature];

  test("boot-validates with cap-list screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("cap-list screen is entityList, SystemAdmin-gated", () => {
    const screen = capCounterFeature.screens[CAP_COUNTER_LIST_SCREEN_ID];
    expect(screen?.type).toBe("entityList");
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(["SystemAdmin"]);
    }
  });

  test("cap-counter list query shares SystemAdmin access", () => {
    expect(rolesOf(capCounterFeature.queryHandlers["cap-counter:list"]?.access)).toEqual([
      "SystemAdmin",
    ]);
  });
});
