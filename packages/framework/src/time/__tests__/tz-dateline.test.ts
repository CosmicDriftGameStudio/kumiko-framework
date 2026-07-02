// Pacific/Apia sits far east of the dateline at UTC+13/+14 — a morning wall
// clock there falls on the PREVIOUS UTC calendar day. Phrased as a date-
// ordering property (not a fixed offset) so the test stays green regardless
// of the tzdata DST view (UTC+13 and +14 both push 10:00 to the prior day).

import { beforeAll, describe, expect, test } from "bun:test";
import { ensureTemporalPolyfill } from "../polyfill";
import { createTzContext } from "../tz-context";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

describe("ctx.tz — Pacific/Apia dateline", () => {
  test("a morning wall clock in Apia maps to the previous UTC calendar day", () => {
    const tz = createTzContext();
    const zdt = tz.parse("2026-01-15T10:00:00", "Pacific/Apia");
    expect(zdt.timeZoneId).toBe("Pacific/Apia");

    const utcDate = zdt.toInstant().toZonedDateTimeISO("UTC").toPlainDate().toString();
    expect(utcDate).toBe("2026-01-14");

    // Offset is a large positive value (UTC+13 or +14).
    expect(zdt.offsetNanoseconds).toBeGreaterThan(12 * 3600 * 1e9);
  });

  test("round-trip preserves wall clock + instant across the dateline", () => {
    const tz = createTzContext();
    const original = tz.parse("2026-01-15T10:00:00", "Pacific/Apia");
    const restored = tz.fromLocatedJson(tz.toLocatedJson(original));
    expect(restored.toInstant().equals(original.toInstant())).toBe(true);
    expect(restored.timeZoneId).toBe("Pacific/Apia");
  });
});
