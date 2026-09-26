import { describe, expect, test } from "bun:test";
import { buildWhatsAppShareUrl } from "../share-links";

describe("buildWhatsAppShareUrl", () => {
  test("without a phone number the link opens the contact picker with the text prefilled", () => {
    expect(buildWhatsAppShareUrl("Hallo Welt")).toBe("https://wa.me/?text=Hallo%20Welt");
  });

  test("encodes line breaks, umlauts and reserved characters so the text arrives unchanged", () => {
    const text = "Škoda für 17.490 €\nProbefahrt? & mehr #1";
    const url = new URL(buildWhatsAppShareUrl(text));
    expect(url.searchParams.get("text")).toBe(text);
  });

  test("normalizes a formatted international number to digits only", () => {
    expect(buildWhatsAppShareUrl("x", "+49 (171) 234-5678")).toBe(
      "https://wa.me/491712345678?text=x",
    );
  });

  test("treats a 00 prefix like +", () => {
    expect(buildWhatsAppShareUrl("x", "0049 171 2345678")).toBe(
      "https://wa.me/491712345678?text=x",
    );
  });
});
