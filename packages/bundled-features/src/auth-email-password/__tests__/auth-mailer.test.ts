import { describe, expect, test } from "bun:test";
import { createInMemoryTransport } from "../../channel-email";
import { createAuthMailerConfig } from "../auth-mailer";

function makeArgs(overrides?: Record<string, unknown>) {
  const mailSender = createInMemoryTransport();
  return {
    mailSender,
    hmacSecret: "test-hmac-secret",
    baseUrl: "https://admin.example.com",
    paths: {
      resetPassword: "/reset-password",
      verifyEmail: "/verify-email",
      signupComplete: "/signup/complete",
      inviteAccept: "/invite/accept",
    },
    appName: "TestApp",
    locale: "en" as const,
    ...overrides,
  };
}

describe("createAuthMailerConfig", () => {
  test("returns all 4 setups", () => {
    const config = createAuthMailerConfig(makeArgs());
    expect(config.passwordReset).toBeDefined();
    expect(config.emailVerification).toBeDefined();
    expect(config.signup).toBeDefined();
    expect(config.invite).toBeDefined();
  });

  test("constructs URLs from baseUrl + paths", () => {
    const config = createAuthMailerConfig(makeArgs());
    expect(config.passwordReset.appResetUrl).toBe("https://admin.example.com/reset-password");
    expect(config.emailVerification.appVerifyUrl).toBe("https://admin.example.com/verify-email");
    expect(config.signup.appActivationUrl).toBe("https://admin.example.com/signup/complete");
    expect(config.invite.appAcceptUrl).toBe("https://admin.example.com/invite/accept");
  });

  test("forwards hmacSecret", () => {
    const config = createAuthMailerConfig(makeArgs());
    expect(config.passwordReset.hmacSecret).toBe("test-hmac-secret");
    expect(config.emailVerification.hmacSecret).toBe("test-hmac-secret");
  });

  test("sendResetEmail calls mailSender.send with rendered content", async () => {
    const args = makeArgs();
    const config = createAuthMailerConfig(args);

    await config.passwordReset.sendResetEmail({
      email: "user@example.com",
      resetUrl: "https://admin.example.com/reset?token=abc",
      expiresAt: "2026-06-09T12:00:00.000Z",
    });

    expect(args.mailSender.sent).toHaveLength(1);
    expect(args.mailSender.sent[0]!.to).toBe("user@example.com");
    expect(args.mailSender.sent[0]!.subject).toContain("TestApp");
    expect(args.mailSender.sent[0]!.subject).toContain("Reset");
    expect(args.mailSender.sent[0]!.html).toContain("https://admin.example.com/reset?token=abc");
  });

  test("sendVerificationEmail calls mailSender.send", async () => {
    const args = makeArgs();
    const config = createAuthMailerConfig(args);

    await config.emailVerification.sendVerificationEmail({
      email: "user@example.com",
      verificationUrl: "https://admin.example.com/verify?token=abc",
      expiresAt: "2026-06-09T12:00:00.000Z",
    });

    expect(args.mailSender.sent).toHaveLength(1);
    expect(args.mailSender.sent[0]!.to).toBe("user@example.com");
    expect(args.mailSender.sent[0]!.subject).toContain("TestApp");
    expect(args.mailSender.sent[0]!.subject).toContain("Verify");
  });

  test("sendActivationEmail calls mailSender.send", async () => {
    const args = makeArgs();
    const config = createAuthMailerConfig(args);

    await config.signup.sendActivationEmail({
      email: "user@example.com",
      activationUrl: "https://admin.example.com/signup/complete?token=abc",
      expiresAt: "2026-06-09T12:00:00.000Z",
    });

    expect(args.mailSender.sent).toHaveLength(1);
    expect(args.mailSender.sent[0]!.to).toBe("user@example.com");
    expect(args.mailSender.sent[0]!.subject).toContain("TestApp");
  });

  test("sendInviteEmail calls mailSender.send with role", async () => {
    const args = makeArgs();
    const config = createAuthMailerConfig(args);

    await config.invite.sendInviteEmail({
      email: "user@example.com",
      inviteUrl: "https://admin.example.com/invite/accept?token=abc",
      expiresAt: "2026-06-09T12:00:00.000Z",
      role: "Admin",
    });

    expect(args.mailSender.sent).toHaveLength(1);
    expect(args.mailSender.sent[0]!.to).toBe("user@example.com");
    expect(args.mailSender.sent[0]!.subject).toContain("TestApp");
    expect(args.mailSender.sent[0]!.html).toContain("Admin");
  });

  test("uses defaults when appName is omitted", () => {
    const config = createAuthMailerConfig(makeArgs({ appName: undefined }));
    expect(config.passwordReset.appResetUrl).toBeDefined();
  });

  test("emailVerificationMode is absent when not provided", () => {
    const config = createAuthMailerConfig(makeArgs());
    expect("mode" in config.emailVerification).toBe(false);
  });

  test("emailVerificationMode is set when provided", () => {
    const config = createAuthMailerConfig(makeArgs({ emailVerificationMode: "strict" }));
    expect(config.emailVerification).toHaveProperty("mode", "strict");
  });

  test("locale 'de' renders German subject", async () => {
    const args = makeArgs({ locale: "de" });
    const config = createAuthMailerConfig(args);

    await config.passwordReset.sendResetEmail({
      email: "user@example.com",
      resetUrl: "https://example.com/reset?token=abc",
      expiresAt: "2026-06-09T12:00:00.000Z",
    });

    expect(args.mailSender.sent[0]!.subject).toContain("Passwort");
  });
});
