import { describe, expect, test } from "bun:test";
import { buildDeletionVerifyUrl } from "../handlers/request-deletion-by-email.write";

describe("buildDeletionVerifyUrl", () => {
  // fw#1554: the token goes in the URL fragment, not a query param —
  // fragments never leave the browser, so they never land in proxy/access
  // logs (unlike ?token=, which does).
  test("puts the token in the URL fragment, not a query param", () => {
    const url = buildDeletionVerifyUrl("https://app.example.com/delete/confirm", "tok-123");
    expect(url).toBe("https://app.example.com/delete/confirm#token=tok-123");
    expect(new URL(url).search).toBe("");
  });

  test("preserves an existing query param — only the token is a fragment", () => {
    const url = buildDeletionVerifyUrl("https://app.example.com/confirm?lang=de", "tok-123");
    expect(url).toBe("https://app.example.com/confirm?lang=de#token=tok-123");
  });

  test("URL-encodes a token with reserved characters", () => {
    const url = new URL(buildDeletionVerifyUrl("https://app.example.com/c", "a b&c=d"));
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("token")).toBe("a b&c=d");
  });
});
