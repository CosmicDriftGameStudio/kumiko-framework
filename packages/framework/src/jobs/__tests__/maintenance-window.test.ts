import { describe, expect, test } from "bun:test";
import { getNextMillis } from "bullmq";
import { isScheduledTrigger, scheduleRepeatOptions } from "../cron-repeat-options.ts";
import { DEFAULT_MAINTENANCE_WINDOW, maintenanceWindowFromEnv } from "../maintenance-window.ts";

describe("maintenanceWindowFromEnv", () => {
  test("unset, empty or blank falls back to 03:00", () => {
    expect(maintenanceWindowFromEnv({})).toEqual(DEFAULT_MAINTENANCE_WINDOW);
    expect(maintenanceWindowFromEnv({ KUMIKO_MAINTENANCE_WINDOW: "" })).toEqual({
      hour: 3,
      minute: 0,
    });
    expect(maintenanceWindowFromEnv({ KUMIKO_MAINTENANCE_WINDOW: "  " })).toEqual({
      hour: 3,
      minute: 0,
    });
  });

  test.each([
    ["00:00", 0, 0],
    ["05:30", 5, 30],
    [" 22:45 ", 22, 45],
    ["23:59", 23, 59],
  ])("%p is read as UTC %i:%i", (value, hour, minute) => {
    expect(maintenanceWindowFromEnv({ KUMIKO_MAINTENANCE_WINDOW: value })).toEqual({
      hour,
      minute,
    });
  });

  test.each(["24:00", "3:00", "03:60", "0300", "03:00:00", "noon", "-1:00", "03.00"])(
    "%p aborts with a message naming the variable",
    (value) => {
      expect(() => maintenanceWindowFromEnv({ KUMIKO_MAINTENANCE_WINDOW: value })).toThrow(
        /KUMIKO_MAINTENANCE_WINDOW/,
      );
    },
  );
});

describe("scheduleRepeatOptions", () => {
  test("a maintenance trigger becomes a daily UTC cron at the window", () => {
    expect(scheduleRepeatOptions({ maintenance: true }, { hour: 5, minute: 30 })).toEqual({
      pattern: "30 5 * * *",
      tz: "UTC",
    });
  });

  test("the pattern fires once a day at the window time", () => {
    const options = scheduleRepeatOptions({ maintenance: true }, { hour: 5, minute: 30 });
    const first = getNextMillis(Date.parse("2026-07-01T06:00:00Z"), options);
    expect(first === undefined ? undefined : new Date(first).toISOString()).toBe(
      "2026-07-02T05:30:00.000Z",
    );
  });

  test("a cron trigger keeps its own pattern and tz", () => {
    expect(
      scheduleRepeatOptions({ cron: "0 9 * * *", tz: "Europe/Berlin" }, { hour: 5, minute: 30 }),
    ).toEqual({ pattern: "0 9 * * *", tz: "Europe/Berlin" });
  });
});

describe("isScheduledTrigger", () => {
  test("is true for cron and maintenance only", () => {
    expect(isScheduledTrigger({ cron: "* * * * *" })).toBe(true);
    expect(isScheduledTrigger({ maintenance: true })).toBe(true);
    expect(isScheduledTrigger({ manual: true })).toBe(false);
    expect(isScheduledTrigger({ on: "x:write:y" })).toBe(false);
  });
});
