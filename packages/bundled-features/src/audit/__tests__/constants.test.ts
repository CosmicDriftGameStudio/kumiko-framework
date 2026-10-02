import { describe, expect, test } from "bun:test";
import {
  ANONYMOUS_USER_ID as FRAMEWORK_ANONYMOUS_USER_ID,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { ANONYMOUS_USER_ID, SYSTEM_ACTOR_ID, SYSTEM_ACTOR_IDS } from "../constants.js";

describe("audit constants", () => {
  test("SYSTEM_ACTOR_ID matches the event-store system user id", () => {
    expect(SYSTEM_ACTOR_ID).toBe("system");
  });

  test("literals stay in sync with the framework engine exports", () => {
    expect(ANONYMOUS_USER_ID).toBe(FRAMEWORK_ANONYMOUS_USER_ID);
    expect(SYSTEM_ACTOR_ID).toBe(SYSTEM_ROLE);
    expect(SYSTEM_ACTOR_IDS.has(SYSTEM_USER_ID)).toBe(true);
  });

  test("SYSTEM_ACTOR_IDS includes createSystemUser nil UUID", () => {
    expect(SYSTEM_ACTOR_IDS.has(SYSTEM_ACTOR_ID)).toBe(true);
    expect(SYSTEM_ACTOR_IDS.has("00000000-0000-0000-0000-000000000000")).toBe(true);
  });
});
