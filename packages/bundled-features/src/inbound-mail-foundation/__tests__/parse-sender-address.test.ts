import { describe, expect, test } from "bun:test";
import { INBOUND_MISSING_SENDER } from "../normalize-inbound-message.ts";
import { parseSenderAddress } from "../parse-sender-address.ts";

describe("parseSenderAddress", () => {
  test("splits a display name from the angle address", () => {
    expect(parseSenderAddress("Max Mustermann <max@firma.de>")).toEqual({
      label: "Max Mustermann",
      email: "max@firma.de",
    });
  });

  test("drops the quotes around a display name", () => {
    expect(parseSenderAddress('"Müller, Anna" <anna@firma.de>')).toEqual({
      label: "Müller, Anna",
      email: "anna@firma.de",
    });
  });

  test("uses a bare address as its own label", () => {
    expect(parseSenderAddress("max@firma.de")).toEqual({
      label: "max@firma.de",
      email: "max@firma.de",
    });
  });

  test("uses the address as label when the angle address has no name", () => {
    expect(parseSenderAddress("<max@firma.de>")).toEqual({
      label: "max@firma.de",
      email: "max@firma.de",
    });
  });

  test("ignores whitespace around the value and the name", () => {
    expect(parseSenderAddress("  Max Mustermann  <max@firma.de>  ")).toEqual({
      label: "Max Mustermann",
      email: "max@firma.de",
    });
  });

  test("yields nothing for empty angle brackets", () => {
    expect(parseSenderAddress("Name <>")).toBeUndefined();
  });

  test("takes the last angle address when two are given", () => {
    expect(parseSenderAddress("a@x.de <b@y.de>")).toEqual({
      label: "a@x.de",
      email: "b@y.de",
    });
    expect(parseSenderAddress("<a@x.de> <b@y.de>")).toEqual({
      label: "<a@x.de>",
      email: "b@y.de",
    });
  });

  test("keeps an opening bracket inside the address", () => {
    expect(parseSenderAddress("Max <<max@firma.de>")).toEqual({
      label: "Max",
      email: "<max@firma.de",
    });
  });

  test("yields no angle address when the name spans lines, falling back to the whole value", () => {
    expect(parseSenderAddress("Max\nMustermann <max@firma.de>")).toEqual({
      label: "Max\nMustermann <max@firma.de>",
      email: "Max\nMustermann <max@firma.de>",
    });
  });

  test("parses a very long run of leading whitespace", () => {
    expect(parseSenderAddress(`${" ".repeat(2000)}Max <max@firma.de>`)).toEqual({
      label: "Max",
      email: "max@firma.de",
    });
    expect(parseSenderAddress(`${" ".repeat(2000)}x`)).toBeUndefined();
  });

  test("yields nothing for the missing-sender placeholder", () => {
    expect(parseSenderAddress(INBOUND_MISSING_SENDER)).toBeUndefined();
  });

  test("yields nothing for a name without an address", () => {
    expect(parseSenderAddress("Max Mustermann")).toBeUndefined();
  });
});
