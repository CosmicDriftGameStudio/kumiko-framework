import { describe, expect, test } from "bun:test";
import { isOperatorStartableTrigger } from "./is-operator-startable-trigger.ts";

describe("isOperatorStartableTrigger", () => {
  test("manual trigger → true", () => {
    expect(isOperatorStartableTrigger({ manual: true })).toBe(true);
  });

  test("maintenance trigger → true", () => {
    expect(isOperatorStartableTrigger({ maintenance: true })).toBe(true);
    expect(isOperatorStartableTrigger({ maintenance: true, wakesSleepingApp: false })).toBe(true);
  });

  test("cron trigger → false", () => {
    expect(isOperatorStartableTrigger({ cron: "*/5 * * * *" })).toBe(false);
  });

  test("event trigger → false", () => {
    expect(isOperatorStartableTrigger({ on: "entity.created" })).toBe(false);
    expect(isOperatorStartableTrigger({ on: ["entity.created", "entity.updated"] })).toBe(false);
  });
});
