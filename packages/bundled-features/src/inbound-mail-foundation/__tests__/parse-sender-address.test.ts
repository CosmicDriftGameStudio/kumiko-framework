import { describe, expect, test } from "bun:test";
import { INBOUND_MISSING_SENDER } from "../normalize-inbound-message.ts";
import { parseSenderAddress } from "../parse-sender-address.ts";

const longWhitespace = " ".repeat(2000);
const multiLineName = "Max\nMustermann <max@firma.de>";

describe("parseSenderAddress", () => {
  test.each([
    ["splits a display name", "Max Mustermann <max@firma.de>", "Max Mustermann", "max@firma.de"],
    ["drops quotes", '"Müller, Anna" <anna@firma.de>', "Müller, Anna", "anna@firma.de"],
    ["uses a bare address as label", "max@firma.de", "max@firma.de", "max@firma.de"],
    ["uses a nameless angle address as label", "<max@firma.de>", "max@firma.de", "max@firma.de"],
    ["ignores outer whitespace", "  Max M  <max@firma.de>  ", "Max M", "max@firma.de"],
    ["takes the angle address over a bare one", "a@x.de <b@y.de>", "a@x.de", "b@y.de"],
    ["takes the last of two angle addresses", "<a@x.de> <b@y.de>", "<a@x.de>", "b@y.de"],
    ["keeps an opening bracket in the address", "Max <<max@firma.de>", "Max", "<max@firma.de"],
    ["keeps the whole value for a multi-line name", multiLineName, multiLineName, multiLineName],
    ["skips long whitespace", `${longWhitespace}Max <max@firma.de>`, "Max", "max@firma.de"],
  ])("%s", (_behavior, from, label, email) => {
    expect(parseSenderAddress(from)).toEqual({ label, email });
  });

  test.each([
    ["empty angle brackets", "Name <>"],
    ["long whitespace without an address", `${longWhitespace}x`],
    ["the missing-sender placeholder", INBOUND_MISSING_SENDER],
    ["a name without an address", "Max Mustermann"],
  ])("yields nothing for %s", (_input, from) => {
    expect(parseSenderAddress(from)).toBeUndefined();
  });
});
