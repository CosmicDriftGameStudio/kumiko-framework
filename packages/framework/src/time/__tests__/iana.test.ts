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

  test("liefert über mehrere Aufrufe konsistent (lazy Set gecacht)", () => {
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Phobos")).toBe(false);
  });
});
