import { describe, expect, test } from "bun:test";
import { SYSTEM_ACTOR_ID } from "../constants";

describe("audit constants", () => {
  test("SYSTEM_ACTOR_ID matches the event-store system user id", () => {
    expect(SYSTEM_ACTOR_ID).toBe("system");
  });
});
