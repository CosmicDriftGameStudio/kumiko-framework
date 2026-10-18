import { describe, expect, test } from "bun:test";
import { getNextMillis } from "bullmq";
import { cronRepeatOptions } from "../cron-repeat-options.ts";

function nextRun(trigger: { cron: string; tz?: string }, after: string): string {
  const next = getNextMillis(Date.parse(after), cronRepeatOptions(trigger));
  if (next === undefined) throw new Error("no next run");
  return new Date(next).toISOString();
}

describe("cronRepeatOptions", () => {
  test("without tz the options carry no tz key", () => {
    expect(cronRepeatOptions({ cron: "0 9 * * *" })).toEqual({ pattern: "0 9 * * *" });
  });

  test("tz is passed through", () => {
    expect(cronRepeatOptions({ cron: "0 9 * * *", tz: "Europe/Berlin" })).toEqual({
      pattern: "0 9 * * *",
      tz: "Europe/Berlin",
    });
  });

  describe("0 9 * * * Europe/Berlin", () => {
    const trigger = { cron: "0 9 * * *", tz: "Europe/Berlin" };

    test("09:00 local is 07:00Z in summer and 08:00Z in winter", () => {
      expect(nextRun(trigger, "2026-07-01T00:00:00Z")).toBe("2026-07-01T07:00:00.000Z");
      expect(nextRun(trigger, "2026-01-01T00:00:00Z")).toBe("2026-01-01T08:00:00.000Z");
    });

    test("stays at 09:00 local across the spring change on 2026-03-29", () => {
      expect(nextRun(trigger, "2026-03-28T08:30:00Z")).toBe("2026-03-29T07:00:00.000Z");
      expect(nextRun(trigger, "2026-03-29T07:00:00Z")).toBe("2026-03-30T07:00:00.000Z");
    });

    test("stays at 09:00 local across the autumn change on 2026-10-25", () => {
      expect(nextRun(trigger, "2026-10-24T07:00:00Z")).toBe("2026-10-25T08:00:00.000Z");
      expect(nextRun(trigger, "2026-10-25T08:00:00Z")).toBe("2026-10-26T08:00:00.000Z");
    });
  });

  describe("30 2 * * * Europe/Berlin (02:30 local)", () => {
    const trigger = { cron: "30 2 * * *", tz: "Europe/Berlin" };

    test("spring change: the skipped 02:30 runs once, shifted to 03:30 local (01:30Z)", () => {
      const spring = [
        nextRun(trigger, "2026-03-28T01:30:00Z"),
        nextRun(trigger, "2026-03-29T00:30:00Z"),
      ];
      expect(spring).toEqual(["2026-03-29T01:30:00.000Z", "2026-03-29T01:30:00.000Z"]);
      expect(nextRun(trigger, "2026-03-29T01:30:00Z")).toBe("2026-03-30T00:30:00.000Z");
    });

    test("autumn change: the doubled 02:30 runs once, on its first occurrence (00:30Z)", () => {
      const autumn = [
        nextRun(trigger, "2026-10-24T01:00:00Z"),
        nextRun(trigger, "2026-10-25T00:30:00Z"),
        nextRun(trigger, "2026-10-25T01:30:00Z"),
      ];
      expect(autumn).toEqual([
        "2026-10-25T00:30:00.000Z",
        "2026-10-26T01:30:00.000Z",
        "2026-10-26T01:30:00.000Z",
      ]);
    });
  });
});
