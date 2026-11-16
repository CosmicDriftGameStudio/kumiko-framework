// Proves createSmtpTransport actually forwards a pinned host + SNI
// servername into nodemailer's createTransport, since EmailTransport's
// public surface (send() only) doesn't expose that otherwise.
//
// Restore hygiene: Bun runs a test-run's files in one process, so a
// top-level mock.module leaks into every file that runs after this one —
// the real exports are snapshotted before mocking and restored in afterAll.
// A snapshot, not the namespace: mock.module rewrites the namespace object in
// place, so restoring from it would reinstall the mock.

import { afterAll, describe, expect, mock, test } from "bun:test";

const realNodemailer = { ...(await import("nodemailer")) };
let capturedOptions: Record<string, unknown> | undefined;
mock.module("nodemailer", () => ({
  createTransport: (options: Record<string, unknown>) => {
    capturedOptions = options;
    return { sendMail: async () => {} };
  },
}));

const { createSmtpTransport } = await import("../smtp-transport.ts");

afterAll(() => {
  mock.module("nodemailer", () => realNodemailer);
});

describe("createSmtpTransport — nodemailer wiring", () => {
  test("pins host to the resolved address and sets servername to the original hostname", () => {
    createSmtpTransport({
      host: "203.0.113.5",
      servername: "smtp.tenant.example",
      from: "noreply@test.local",
    });
    expect(capturedOptions?.["host"]).toBe("203.0.113.5");
    expect(capturedOptions?.["servername"]).toBe("smtp.tenant.example");
  });

  test("omits servername when the connect target is already the raw host (IP-literal or allowlisted)", () => {
    createSmtpTransport({ host: "mailpit.internal", from: "noreply@test.local" });
    expect(capturedOptions?.["host"]).toBe("mailpit.internal");
    expect(capturedOptions?.["servername"]).toBeUndefined();
  });
});

describe("createSmtpTransport — TLS and pooling", () => {
  test("requires STARTTLS when not using implicit TLS", () => {
    createSmtpTransport({ host: "smtp.example", secure: false, from: "noreply@test.local" });
    expect(capturedOptions?.["requireTLS"]).toBe(true);
    createSmtpTransport({ host: "smtp.example", from: "noreply@test.local" });
    expect(capturedOptions?.["requireTLS"]).toBe(true);
  });

  test("does not require STARTTLS on implicit TLS", () => {
    createSmtpTransport({ host: "smtp.example", secure: true, from: "noreply@test.local" });
    expect(capturedOptions?.["requireTLS"]).toBe(false);
  });

  test("pools by default and not when built per send", () => {
    createSmtpTransport({ host: "smtp.example", from: "noreply@test.local" });
    expect(capturedOptions?.["pool"]).toBe(true);
    createSmtpTransport({ host: "smtp.example", from: "noreply@test.local", pooled: false });
    expect(capturedOptions?.["pool"]).toBe(false);
  });
});
