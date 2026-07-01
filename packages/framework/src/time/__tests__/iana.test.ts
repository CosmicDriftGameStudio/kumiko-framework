import { describe, expect, test } from "bun:test";
import { isValidIanaTimeZone } from "../iana";

describe("isValidIanaTimeZone", () => {
  // Die 5 Zonen der geplanten CI-TZ-Matrix (timezones.md) müssen alle gültig
  // sein — sonst kann die Matrix sie nicht setzen.
  test.each([
    "UTC",
    "Europe/Berlin",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Pacific/Apia",
  ])("akzeptiert kanonische Zone %s", (zone) => {
    expect(isValidIanaTimeZone(zone)).toBe(true);
  });

  test.each([
    "",
    "Mars/Phobos",
    "europe/berlin",
    "Europe/Berlin ",
    "GMT+2",
    "not-a-zone",
  ])("lehnt ungültigen / nicht-kanonischen String %p ab", (value) => {
    expect(isValidIanaTimeZone(value)).toBe(false);
  });

  // Intl.supportedValuesOf("timeZone") listet nur kanonische Namen — gültige
  // IANA-Aliase fehlen darin, obwohl Intl.DateTimeFormat/Temporal/ctx.tz.parse
  // sie klaglos akzeptieren. Ein valider Alias darf hier nicht als "invalid"
  // rejected werden (stiller Breaking-Change für Consumer, die Alias-Zonen
  // speichern).
  test.each(["US/Pacific", "GMT", "Etc/UTC"])("akzeptiert gültigen IANA-Alias %s", (zone) => {
    expect(isValidIanaTimeZone(zone)).toBe(true);
  });

  test("liefert über mehrere Aufrufe konsistent (lazy Set gecacht)", () => {
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Phobos")).toBe(false);
  });
});
