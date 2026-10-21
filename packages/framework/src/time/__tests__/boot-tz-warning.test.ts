import { describe, expect, test } from "bun:test";
import { warnIfNonUtcServerTimeZone } from "../boot-tz-warning.ts";

describe("warnIfNonUtcServerTimeZone", () => {
  test("warnt nicht wenn die Prozess-TZ UTC ist", () => {
    const messages: string[] = [];
    const warned = warnIfNonUtcServerTimeZone("UTC", (m) => messages.push(m));
    expect(warned).toBe(false);
    expect(messages).toHaveLength(0);
  });

  test.each(["GMT", "Etc/UTC"])("warnt nicht bei UTC-äquivalenter Zone %s", (zone) => {
    const messages: string[] = [];
    const warned = warnIfNonUtcServerTimeZone(zone, (m) => messages.push(m));
    expect(warned).toBe(false);
    expect(messages).toHaveLength(0);
  });

  test("warnt bei nicht-UTC Zone, nennt Zone + UTC-Hinweis", () => {
    const messages: string[] = [];
    const warned = warnIfNonUtcServerTimeZone("Europe/Berlin", (m) => messages.push(m));
    expect(warned).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Europe/Berlin");
    expect(messages[0]).toContain("UTC");
  });

  test("Default-Aufruf liest die ECHTE Prozess-TZ (ambient, nicht injiziert)", () => {
    // This is the only test that reads the ambient time zone instead of injecting it—
    // allowing the tz-matrix CI job (4 legs: LA/Berlin/Tokyo/Apia) to distinguish
    // between its legs. Without this assertion, "runs in every zone without throwing"
    // would be identically green in all 4 legs, and the advertised protection ("a
    // `new Date(wallClock)` bug breaks HERE") would not exist.
    const ambientTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const messages: string[] = [];
    const warned = warnIfNonUtcServerTimeZone(undefined, (m) => messages.push(m));
    if (ambientTz === "UTC") {
      expect(warned).toBe(false);
      expect(messages).toHaveLength(0);
    } else {
      expect(warned).toBe(true);
      expect(messages[0]).toContain(ambientTz);
    }
  });
});
