import { describe, expect, test } from "bun:test";
import { buildDeletionVerifyUrl } from "../handlers/request-deletion-by-email.write";

describe("buildDeletionVerifyUrl", () => {
  test("appends ?token to a plain base URL", () => {
    expect(buildDeletionVerifyUrl("https://app.example.com/delete/confirm", "tok-123")).toBe(
      "https://app.example.com/delete/confirm?token=tok-123",
    );
  });

  test("appends &token when the base already carries query params (not a second ?)", () => {
    const url = buildDeletionVerifyUrl("https://app.example.com/confirm?lang=de", "tok-123");
    expect(url).toBe("https://app.example.com/confirm?lang=de&token=tok-123");
    expect(url.match(/\?/g)).toHaveLength(1);
  });

  test("URL-encodes a token with reserved characters", () => {
    const url = new URL(buildDeletionVerifyUrl("https://app.example.com/c", "a b&c=d"));
    expect(url.searchParams.get("token")).toBe("a b&c=d");
  });
});
