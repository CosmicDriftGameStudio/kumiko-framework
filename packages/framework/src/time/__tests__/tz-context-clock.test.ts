import { beforeAll, describe, expect, test } from "bun:test";
import { createManualClock } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { ensureTemporalPolyfill } from "../polyfill.js";
import { createTzContext } from "../tz-context.js";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

describe("createTzContext — injected clock", () => {
  test("now reports the clock, not the system time", () => {
    const clock = createManualClock(Temporal.Instant.from("2020-01-01T10:00:00Z"));
    const tz = createTzContext({ clock });

    expect(tz.now().toString()).toBe("2020-01-01T10:00:00Z");
    clock.advance({ hours: 2 });
    expect(tz.now().toString()).toBe("2020-01-01T12:00:00Z");
  });

  test("today and todayRange cross midnight per zone as the clock advances", () => {
    const clock = createManualClock(Temporal.Instant.from("2026-03-10T22:30:00Z"));
    const tz = createTzContext({ clock });

    expect(tz.today("UTC").toString()).toBe("2026-03-10");
    expect(tz.today("Europe/Lisbon").toString()).toBe("2026-03-10");
    expect(tz.today("Asia/Tokyo").toString()).toBe("2026-03-11");
    expect(tz.nowIn("Asia/Tokyo").hour).toBe(7);

    clock.advance({ hours: 2 });

    expect(tz.today("UTC").toString()).toBe("2026-03-11");
    const range = tz.todayRange("UTC");
    expect(range.start.toString()).toBe("2026-03-11T00:00:00Z");
    expect(range.end.toString()).toBe("2026-03-12T00:00:00Z");
  });

  test("set jumps the clock", () => {
    const clock = createManualClock(Temporal.Instant.from("2026-01-01T00:00:00Z"));
    const tz = createTzContext({ clock });

    clock.set(Temporal.Instant.from("2030-06-15T12:00:00Z"));

    expect(tz.now().toString()).toBe("2030-06-15T12:00:00Z");
  });
});
