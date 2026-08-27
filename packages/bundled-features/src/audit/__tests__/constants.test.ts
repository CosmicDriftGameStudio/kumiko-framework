import { describe, expect, test } from "bun:test";
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_IDS } from "../constants";

describe("audit constants", () => {
  test("SYSTEM_ACTOR_ID matches the event-store system user id", () => {
    expect(SYSTEM_ACTOR_ID).toBe("system");
  });

  test("SYSTEM_ACTOR_IDS includes createSystemUser nil UUID", () => {
    expect(SYSTEM_ACTOR_IDS.has(SYSTEM_ACTOR_ID)).toBe(true);
    expect(SYSTEM_ACTOR_IDS.has("00000000-0000-0000-0000-000000000000")).toBe(true);
  });
});
