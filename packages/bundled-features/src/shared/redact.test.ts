import { describe, expect, test } from "bun:test";
import { redactEmailAddresses, redactErrorText, redactUrls } from "./redact.js";

describe("redactUrls", () => {
  test("hides a Telegram bot token in the path", () => {
    const out = redactUrls(
      "fetch failed: https://api.telegram.org/bot123456:AAHsecret/sendMessage",
    );
    expect(out).toBe("fetch failed: https://api.telegram.org/[redacted]");
  });

  test("hides a Slack hook path", () => {
    const out = redactUrls("POST https://hooks.slack.com/services/T000/B000/XXXX failed");
    expect(out).toBe("POST https://hooks.slack.com/[redacted] failed");
  });

  test("drops userinfo", () => {
    const out = redactUrls("connect http://user:pass@internal.example:8080 refused");
    expect(out).toBe("connect http://internal.example:8080 refused");
    expect(redactUrls("http://user:pass@internal.example/x")).not.toContain("pass");
  });

  test("hides query tokens and fragments", () => {
    expect(redactUrls("https://api.example.com?token=abc123")).toBe(
      "https://api.example.com/[redacted]",
    );
    expect(redactUrls("see https://api.example.com/v1/x?key=abc#frag")).not.toContain("abc");
  });

  test("leaves text without URLs alone", () => {
    expect(redactUrls("socket hang up")).toBe("socket hang up");
  });
});

describe("redactErrorText", () => {
  test("redacts URLs and addresses together", () => {
    const out = redactErrorText(
      "550 <ops@example.com> rejected via https://h.example/hook/SECRET123",
    );
    expect(out).not.toContain("SECRET123");
    expect(out).not.toContain("ops@example.com");
    expect(redactEmailAddresses("a@b.co")).toBe("[redacted-address]");
  });
});
