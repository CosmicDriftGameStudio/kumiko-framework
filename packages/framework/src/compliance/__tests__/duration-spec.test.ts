// Unit-Tests fuer DurationSpec-Helpers (S2.U5a.fix2).
//
// Pinst beide Discriminated-Union-Branches (`{days}` + `{hours}`) plus
// Edge-Cases die in den Integration-Tests nicht auftauchen (0-Werte,
// Singular/Plural). Der Bug aus dem U5a-Review (`{hours: 6}` fiel auf
// 30d-Default) wird hier zentral verhindert.

import { beforeAll, describe, expect, test } from "bun:test";
import { ensureTemporalPolyfill, getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  addDurationSpec,
  describeDurationSpec,
  durationSpecToMs,
  subtractRetentionSpec,
} from "../duration-spec.js";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

describe("durationSpecToMs", () => {
  test("days → days * 86_400_000", () => {
    expect(durationSpecToMs({ days: 30 })).toBe(30 * 24 * 60 * 60 * 1000);
    expect(durationSpecToMs({ days: 1 })).toBe(24 * 60 * 60 * 1000);
  });

  test("hours → hours * 3_600_000", () => {
    expect(durationSpecToMs({ hours: 6 })).toBe(6 * 60 * 60 * 1000);
    expect(durationSpecToMs({ hours: 72 })).toBe(72 * 60 * 60 * 1000);
  });

  test("0-Werte ergeben 0", () => {
    expect(durationSpecToMs({ days: 0 })).toBe(0);
    expect(durationSpecToMs({ hours: 0 })).toBe(0);
  });
});

describe("addDurationSpec", () => {
  test("days addiert exakt zu Instant.epochMilliseconds", () => {
    const T = getTemporal();
    const t0 = T.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const t1 = addDurationSpec(t0, { days: 30 });
    expect(t1.epochMilliseconds - t0.epochMilliseconds).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("hours addiert exakt zu Instant.epochMilliseconds", () => {
    const T = getTemporal();
    const t0 = T.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const t1 = addDurationSpec(t0, { hours: 6 });
    expect(t1.epochMilliseconds - t0.epochMilliseconds).toBe(6 * 60 * 60 * 1000);
  });

  // Regression-Guard fuer den U5a-Bug: vorher fiel `{hours: 6}` auf
  // `30 * 86_400_000`-Default zurueck. Wenn jemand den Branch wieder
  // verliert, faellt dieser Test sofort um.
  test("hours-Branch ist NICHT auf days-Default mappable (U5a-Regression)", () => {
    const T = getTemporal();
    const t0 = T.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const tHours = addDurationSpec(t0, { hours: 6 });
    const tDaysDefault = addDurationSpec(t0, { days: 30 });
    expect(tHours.epochMilliseconds).not.toBe(tDaysDefault.epochMilliseconds);
  });
});

describe("describeDurationSpec", () => {
  test("days mit Pluralisierung", () => {
    expect(describeDurationSpec({ days: 30 })).toBe("30 days");
    expect(describeDurationSpec({ days: 1 })).toBe("1 day");
    expect(describeDurationSpec({ days: 0 })).toBe("0 days");
  });

  test("hours mit Pluralisierung", () => {
    expect(describeDurationSpec({ hours: 72 })).toBe("72 hours");
    expect(describeDurationSpec({ hours: 1 })).toBe("1 hour");
    expect(describeDurationSpec({ hours: 0 })).toBe("0 hours");
  });
});

describe("subtractRetentionSpec", () => {
  const at = (iso: string) => getTemporal().Instant.from(iso);

  test("days and hours subtract fixed durations", () => {
    const now = at("2026-03-10T12:00:00Z");
    expect(subtractRetentionSpec(now, { days: 90 }).toString()).toBe("2025-12-10T12:00:00Z");
    expect(subtractRetentionSpec(now, { hours: 6 }).toString()).toBe("2026-03-10T06:00:00Z");
  });

  test("months clamp over month end on the UTC calendar", () => {
    expect(subtractRetentionSpec(at("2026-05-31T08:00:00Z"), { months: 3 }).toString()).toBe(
      "2026-02-28T08:00:00Z",
    );
    expect(subtractRetentionSpec(at("2026-03-31T00:00:00Z"), { months: 1 }).toString()).toBe(
      "2026-02-28T00:00:00Z",
    );
  });

  test("years span leap days and clamp Feb 29", () => {
    expect(subtractRetentionSpec(at("2028-02-29T10:00:00Z"), { years: 1 }).toString()).toBe(
      "2027-02-28T10:00:00Z",
    );
    const now = at("2026-03-01T00:00:00Z");
    const tenYears = subtractRetentionSpec(now, { years: 10 });
    expect(tenYears.toString()).toBe("2016-03-01T00:00:00Z");
    // 10 calendar years contain 2 leap days more than 3650 fixed days
    expect((now.epochMilliseconds - tenYears.epochMilliseconds) / 86_400_000).toBe(3652);
  });
});
