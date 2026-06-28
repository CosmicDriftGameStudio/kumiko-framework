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

  test("Default-Aufruf liest die Prozess-TZ ohne zu werfen", () => {
    expect(() => warnIfNonUtcServerTimeZone(undefined, () => {})).not.toThrow();
  });
});
