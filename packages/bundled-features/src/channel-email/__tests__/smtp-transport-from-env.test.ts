import { describe, expect, test } from "bun:test";
import { createSmtpTransportFromEnv } from "../smtp-transport";

describe("createSmtpTransportFromEnv", () => {
  test("no SMTP_HOST → null (no-mail, not crash)", () => {
    expect(createSmtpTransportFromEnv({}, { fallbackFrom: "x@y.z" })).toBeNull();
    expect(
      createSmtpTransportFromEnv(
        { SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "a@b.c" },
        { fallbackFrom: "x@y.z" },
      ),
    ).toBeNull();
  });

  test("host present → transport with send()", () => {
    const t = createSmtpTransportFromEnv({ SMTP_HOST: "localhost" }, { fallbackFrom: "x@y.z" });
    expect(t).not.toBeNull();
    expect(typeof t?.send).toBe("function");
  });

  test("full env (port coercion + auth) builds without throwing", () => {
    const t = createSmtpTransportFromEnv(
      {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "user",
        SMTP_PASS: "pass",
        SMTP_FROM: "App <noreply@example.com>",
      },
      { fallbackFrom: "x@y.z" },
    );
    expect(typeof t?.send).toBe("function");
  });
});
