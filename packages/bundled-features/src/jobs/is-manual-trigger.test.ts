import { describe, expect, test } from "bun:test";
import { isManualTrigger } from "./is-manual-trigger";

describe("isManualTrigger", () => {
  test("manual trigger → true", () => {
    expect(isManualTrigger({ manual: true })).toBe(true);
  });

  test("cron trigger → false", () => {
    expect(isManualTrigger({ cron: "*/5 * * * *" })).toBe(false);
  });

  test("event trigger → false", () => {
    expect(isManualTrigger({ on: "entity.created" })).toBe(false);
    expect(isManualTrigger({ on: ["entity.created", "entity.updated"] })).toBe(false);
  });
});
