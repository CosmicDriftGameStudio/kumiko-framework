// Unit-Tests fuer DurationSpec-Helpers (S2.U5a.fix2).
//
// Pinst beide Discriminated-Union-Branches (`{days}` + `{hours}`) plus
// Edge-Cases die in den Integration-Tests nicht auftauchen (0-Werte,
// Singular/Plural). Der Bug aus dem U5a-Review (`{hours: 6}` fiel auf
// 30d-Default) wird hier zentral verhindert.

import { ensureTemporalPolyfill, getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { beforeAll, describe, expect, test } from "vitest";
import { addDurationSpec, describeDurationSpec, durationSpecToMs } from "../duration-spec";

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
