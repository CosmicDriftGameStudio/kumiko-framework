import { describe, expect, test } from "bun:test";
import { createInMemoryTransport } from "../../channel-email";
import { createAuthMailerConfig } from "../auth-mailer";

// Reset + verify migrated to delivery (ctx.notify); auth-mailer now only
// builds the signup + invite callbacks.
function makeArgs(overrides?: Record<string, unknown>) {
  const mailSender = createInMemoryTransport();
  return {
    mailSender,
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
  test("returns signup + invite setups", () => {
    const config = createAuthMailerConfig(makeArgs());
    expect(config.signup).toBeDefined();
    expect(config.invite).toBeDefined();
  });

  test("constructs URLs from baseUrl + paths", () => {
    const config = createAuthMailerConfig(makeArgs());
    expect(config.signup.appActivationUrl).toBe("https://admin.example.com/signup/complete");
    expect(config.invite.appAcceptUrl).toBe("https://admin.example.com/invite/accept");
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
    expect(args.mailSender.sent[0]!.html).toContain(
      "https://admin.example.com/signup/complete?token=abc",
    );
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
    expect(config.signup.appActivationUrl).toBeDefined();
  });

  test("locale 'de' renders German subject", async () => {
    const args = makeArgs({ locale: "de" });
    const config = createAuthMailerConfig(args);

    await config.signup.sendActivationEmail({
      email: "user@example.com",
      activationUrl: "https://example.com/signup/complete?token=abc",
      expiresAt: "2026-06-09T12:00:00.000Z",
    });

    expect(args.mailSender.sent[0]!.subject).toContain("aktivieren");
  });
});
