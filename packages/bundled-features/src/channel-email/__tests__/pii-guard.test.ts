import { afterEach, describe, expect, test } from "bun:test";
import { guardEmailMessage, withPiiCiphertextGuard } from "../pii-guard";
import { createInMemoryTransport } from "../types";

const CIPHERTEXT = "kumiko-pii:v1:user:6b2f4a0e-1c9d-4f3a-9d2e-00000000000a:8e2Rkjj+ww==";
const originalNodeEnv = process.env["NODE_ENV"];

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = originalNodeEnv;
});

describe("guardEmailMessage", () => {
  test("clean message passes through untouched", () => {
    const msg = { to: "marc@example.com", subject: "Hi", html: "<p>Hi</p>" };
    expect(guardEmailMessage(msg)).toBe(msg);
  });

  test("ciphertext recipient is always refused — even in production", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => guardEmailMessage({ to: CIPHERTEXT, subject: "Hi", html: "x" })).toThrow(
      /recipient address is a PII ciphertext/,
    );
  });

  test("ciphertext in body fails loud outside production", () => {
    expect(() =>
      guardEmailMessage({ to: "marc@example.com", subject: "Hi", html: `<p>${CIPHERTEXT}</p>` }),
    ).toThrow(/subject\/body contains a PII ciphertext/);
  });

  test("production redacts body/subject instead of throwing", () => {
    process.env["NODE_ENV"] = "production";
    const out = guardEmailMessage({
      to: "marc@example.com",
      subject: `Re: ${CIPHERTEXT}`,
      html: `<p>${CIPHERTEXT}</p>`,
    });
    expect(out.subject).toBe("Re: [pii-redacted]");
    expect(out.html).toBe("<p>[pii-redacted]</p>");
  });
});

describe("withPiiCiphertextGuard", () => {
  test("wrapped transport refuses a ciphertext recipient before sending", async () => {
    const inner = createInMemoryTransport();
    const guarded = withPiiCiphertextGuard(inner);
    await expect(guarded.send({ to: CIPHERTEXT, subject: "x", html: "y" })).rejects.toThrow(
      /recipient address is a PII ciphertext/,
    );
    expect(inner.sent).toHaveLength(0);

    await guarded.send({ to: "ok@example.com", subject: "x", html: "y" });
    expect(inner.sent).toHaveLength(1);
  });
});
