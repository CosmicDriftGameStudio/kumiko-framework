import { describe, expect, test } from "bun:test";
import { type RunProdAppAuthOptions, resolveAuthMail } from "../run-prod-app";

// Pins the auth.mail convenience (resolveAuthMail): one mail block expands
// into the four explicit flow setups built from DEFAULT_AUTH_PATHS, the
// null-transport guard (no SMTP_HOST → flows stay unwired), and explicit
// per-flow setups winning over the mail default.

const admin: RunProdAppAuthOptions["admin"] = {
  email: "admin@example.com",
  password: "pw-long-enough",
  displayName: "Admin",
  memberships: [],
};

const withMail: RunProdAppAuthOptions = {
  admin,
  mail: { baseUrl: "https://app.example.com", appName: "Test" },
};

describe("resolveAuthMail", () => {
  test("no mail block → auth returned unchanged", () => {
    const noMail: RunProdAppAuthOptions = { admin };
    const out = resolveAuthMail(noMail, "secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset).toBeUndefined();
    expect(out.signup).toBeUndefined();
  });

  test("mail + SMTP_HOST → all four flows wired from DEFAULT_AUTH_PATHS", () => {
    const out = resolveAuthMail(withMail, "secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.appResetUrl).toBe("https://app.example.com/reset-password");
    expect(out.emailVerification?.appVerifyUrl).toBe("https://app.example.com/verify-email");
    expect(out.signup?.appActivationUrl).toBe("https://app.example.com/signup/complete");
    expect(out.invite?.appAcceptUrl).toBe("https://app.example.com/invite/accept");
    expect(typeof out.passwordReset?.sendResetEmail).toBe("function");
  });

  test("mail but NO SMTP_HOST → null-transport guard, flows stay unwired", () => {
    const out = resolveAuthMail(withMail, "secret", {});
    expect(out.passwordReset).toBeUndefined();
    expect(out.signup).toBeUndefined();
  });

  test("explicit per-flow setup wins over the mail default", () => {
    const explicit: RunProdAppAuthOptions = {
      ...withMail,
      passwordReset: {
        hmacSecret: "h",
        appResetUrl: "https://custom.example.com/pw",
        sendResetEmail: async () => {},
      },
    };
    const out = resolveAuthMail(explicit, "secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.appResetUrl).toBe("https://custom.example.com/pw");
    // other flows still come from the mail default
    expect(out.signup?.appActivationUrl).toBe("https://app.example.com/signup/complete");
  });

  test("paths override only affects the named path", () => {
    const pathsOverride: RunProdAppAuthOptions = {
      admin,
      mail: { baseUrl: "https://app.example.com", paths: { resetPassword: "/pw" } },
    };
    const out = resolveAuthMail(pathsOverride, "secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.appResetUrl).toBe("https://app.example.com/pw");
    expect(out.emailVerification?.appVerifyUrl).toBe("https://app.example.com/verify-email");
  });
});
