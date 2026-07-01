import { describe, expect, test } from "bun:test";
import { warnIfNonUtcServerTimeZone } from "../boot-tz-warning";

describe("warnIfNonUtcServerTimeZone", () => {
  test("warnt nicht wenn die Prozess-TZ UTC ist", () => {
    const messages: string[] = [];
    const warned = warnIfNonUtcServerTimeZone("UTC", (m) => messages.push(m));
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
    // Das ist der einzige Test der ambient-TZ liest statt sie zu injizieren —
    // der Grund warum der tz-matrix-CI-Job (4 Legs: LA/Berlin/Tokyo/Apia)
    // überhaupt einen Unterschied zwischen den Legs sehen kann. Ohne diese
    // Assertion wäre "läuft in jeder Zone ohne zu werfen" in allen 4 Legs
    // identisch grün — die beworbene Schutzwirkung ("ein `new Date(wallClock)`-
    // Bug bricht HIER") würde nicht existieren.
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
