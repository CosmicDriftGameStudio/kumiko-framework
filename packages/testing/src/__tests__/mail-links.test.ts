import { describe, expect, test } from "bun:test";
import {
  decodeHtmlAttribute,
  extractMailLink,
  extractMailLinkToken,
  mailLinks,
} from "../e2e/mail-links";

const mail = {
  to: "anna@example.com",
  html: '<p><a href="https://app.example/confirm?token&#x3D;abc&amp;lang&#61;de">Confirm</a> <a href="https://app.example/unsubscribe?t&#x3D;x">Unsubscribe</a></p>',
};

describe("mail links", () => {
  test("hrefs are decoded from hex, decimal and named entities", () => {
    expect(mailLinks(mail)).toEqual([
      "https://app.example/confirm?token=abc&lang=de",
      "https://app.example/unsubscribe?t=x",
    ]);
  });

  test("decoding is a single pass, an encoded entity stays literal", () => {
    expect(decodeHtmlAttribute("a&amp;#x3D;b")).toBe("a&#x3D;b");
    expect(decodeHtmlAttribute("a&unknown;b")).toBe("a&unknown;b");
  });

  test("the first link containing the fragment is returned, its token parsed", () => {
    expect(extractMailLink(mail, "/confirm")).toBe("https://app.example/confirm?token=abc&lang=de");
    expect(extractMailLinkToken(mail, "/confirm")).toBe("abc");
    expect(extractMailLinkToken(mail, "/unsubscribe", "t")).toBe("x");
  });

  test("a missing link or token fails with the recipient in the message", () => {
    expect(() => extractMailLink(mail, "/reset")).toThrow("anna@example.com");
    expect(() => extractMailLinkToken(mail, "/unsubscribe")).toThrow('"token"');
  });
});
