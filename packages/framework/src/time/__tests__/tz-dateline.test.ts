// Pacific/Apia (Samoa) liegt weit östlich der Datumsgrenze bei UTC+13/+14 —
// eine Vormittags-Wall-Clock dort fällt in UTC auf den VORHERIGEN Kalendertag.
// Das Plan-Doc (timezones.md) nennt Apia explizit als Datumsgrenzen-Edge-Case
// der TZ-Matrix. Als Datums-Ordnungs-Eigenschaft formuliert, damit der Test
// unabhängig von der DST-Sicht der tzdata grün bleibt (UTC+13 wie +14 schieben
// 10:00 auf den Vortag).

import { beforeAll, describe, expect, test } from "bun:test";
import { ensureTemporalPolyfill } from "../polyfill";
import { createTzContext } from "../tz-context";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

describe("ctx.tz — Pacific/Apia Datumsgrenze", () => {
  test("Vormittags-Wall-Clock in Apia mappt auf den vorherigen UTC-Kalendertag", () => {
    const tz = createTzContext();
    const zdt = tz.parse("2026-01-15T10:00:00", "Pacific/Apia");
    expect(zdt.timeZoneId).toBe("Pacific/Apia");

    const utcDate = zdt.toInstant().toZonedDateTimeISO("UTC").toPlainDate().toString();
    expect(utcDate).toBe("2026-01-14");

    // Offset ist ein großer positiver Wert (UTC+13 oder +14).
    expect(zdt.offsetNanoseconds).toBeGreaterThan(12 * 3600 * 1e9);
  });

  test("Round-Trip bewahrt Wall-Clock + Instant über die Datumsgrenze", () => {
    const tz = createTzContext();
    const original = tz.parse("2026-01-15T10:00:00", "Pacific/Apia");
    const restored = tz.fromLocatedJson(tz.toLocatedJson(original));
    expect(restored.toInstant().equals(original.toInstant())).toBe(true);
    expect(restored.timeZoneId).toBe("Pacific/Apia");
  });
});
