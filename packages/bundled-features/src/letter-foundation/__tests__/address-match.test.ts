import { describe, expect, test } from "bun:test";
import { recognizedAddressMatches } from "../address-match.ts";

const expected = {
  name: "Erika Mustermann",
  street: "Musterstraße",
  houseNumber: "12",
  postalCode: "12345",
  city: "Musterstadt",
};
const senderLine = "Beispiel Hausverwaltung GmbH, Beispielweg 1, 54321 Beispielstadt";

describe("recognizedAddressMatches", () => {
  test("finds the recipient after the sender line", () => {
    expect(
      recognizedAddressMatches(
        expected,
        `${senderLine}, , Erika Mustermann, Musterstraße 12, 12345 Musterstadt`,
      ),
    ).toBe(true);
  });

  test("ignores case and extra whitespace", () => {
    expect(
      recognizedAddressMatches(
        expected,
        "ERIKA   MUSTERMANN,  musterstrasse  12, 12345 MUSTERSTADT",
      ),
    ).toBe(true);
  });

  test("treats Str. and Straße alike in either direction", () => {
    expect(
      recognizedAddressMatches(expected, "Erika Mustermann, Musterstr. 12, 12345 Musterstadt"),
    ).toBe(true);
    expect(
      recognizedAddressMatches(
        { ...expected, street: "Musterstr." },
        "Erika Mustermann, Musterstraße 12, 12345 Musterstadt",
      ),
    ).toBe(true);
  });

  test("matches on the last name when the provider drops the first name", () => {
    expect(
      recognizedAddressMatches(expected, "Mustermann, Musterstraße 12, 12345 Musterstadt"),
    ).toBe(true);
  });

  test.each([
    ["another street", "Erika Mustermann, Beispielgasse 12, 12345 Musterstadt"],
    ["another house number", "Erika Mustermann, Musterstraße 21, 12345 Musterstadt"],
    ["another postal code", "Erika Mustermann, Musterstraße 12, 99999 Musterstadt"],
    ["another city", "Erika Mustermann, Musterstraße 12, 12345 Andernorts"],
    ["another name", "Max Beispiel, Musterstraße 12, 12345 Musterstadt"],
    ["only the sender", senderLine],
  ])("rejects %s", (_label, recognized) => {
    expect(recognizedAddressMatches(expected, recognized)).toBe(false);
  });

  test("treats Str without a dot like Straße", () => {
    expect(
      recognizedAddressMatches(
        { ...expected, street: "Hauptstr", houseNumber: "5" },
        "Erika Mustermann, Hauptstraße 5, 12345 Musterstadt",
      ),
    ).toBe(true);
  });

  test("treats 12a and 12 a alike", () => {
    expect(
      recognizedAddressMatches(
        { ...expected, houseNumber: "12a" },
        "Erika Mustermann, Musterstraße 12 a, 12345 Musterstadt",
      ),
    ).toBe(true);
  });

  test("a different house number still differs", () => {
    expect(
      recognizedAddressMatches(
        { ...expected, houseNumber: "12a" },
        "Erika Mustermann, Musterstraße 12 b, 12345 Musterstadt",
      ),
    ).toBe(false);
  });
});
