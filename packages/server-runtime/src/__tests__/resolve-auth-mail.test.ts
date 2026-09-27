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
    // All four flows carry appUrl as feature options — each handler mails via
    // delivery (ctx.notify); no callback wiring remains.
    expect(out.passwordReset?.appUrl).toBe("https://app.example.com/reset-password");
    expect(out.emailVerification?.appUrl).toBe("https://app.example.com/verify-email");
    expect(out.signup?.appUrl).toBe("https://app.example.com/signup/complete");
    expect(out.invite?.appUrl).toBe("https://app.example.com/invite/accept");
    expect(out.passwordReset?.hmacSecret).toBe("secret");
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
        appUrl: "https://custom.example.com/pw",
      },
    };
    const out = resolveAuthMail(explicit, "secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.appUrl).toBe("https://custom.example.com/pw");
    // other flows still come from the mail default
    expect(out.signup?.appUrl).toBe("https://app.example.com/signup/complete");
  });

  test("paths override only affects the named path", () => {
    const pathsOverride: RunProdAppAuthOptions = {
      admin,
      mail: { baseUrl: "https://app.example.com", paths: { resetPassword: "/pw" } },
    };
    const out = resolveAuthMail(pathsOverride, "secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.appUrl).toBe("https://app.example.com/pw");
    expect(out.emailVerification?.appUrl).toBe("https://app.example.com/verify-email");
  });

  test("function path → locale-aware appUrl, still signed with the resolved hmacSecret", () => {
    const localeAware: RunProdAppAuthOptions = {
      admin,
      mail: {
        baseUrl: "https://app.example.com",
        paths: {
          resetPassword: (locale) => (locale === "de" ? "/de/reset-password" : "/reset-password"),
        },
      },
    };
    const out = resolveAuthMail(localeAware, "secret", { SMTP_HOST: "localhost" });
    const appUrl = out.passwordReset?.appUrl;
    if (typeof appUrl !== "function") throw new Error("expected a locale-aware appUrl function");
    expect(appUrl("de")).toBe("https://app.example.com/de/reset-password");
    expect(appUrl("en")).toBe("https://app.example.com/reset-password");
    expect(out.passwordReset?.hmacSecret).toBe("secret");
  });

  test("mail.hmacSecret overrides the call-site secret for passwordReset and emailVerification", () => {
    const dedicatedSecret: RunProdAppAuthOptions = {
      admin,
      mail: { baseUrl: "https://app.example.com", hmacSecret: "mail-only-secret" },
    };
    const out = resolveAuthMail(dedicatedSecret, "jwt-secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.hmacSecret).toBe("mail-only-secret");
    expect(out.emailVerification?.hmacSecret).toBe("mail-only-secret");
  });

  test("no mail.hmacSecret → falls back to the call-site secret", () => {
    const out = resolveAuthMail(withMail, "jwt-secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.hmacSecret).toBe("jwt-secret");
  });

  test("explicit passwordReset/emailVerification without hmacSecret is backfilled from mail.hmacSecret", () => {
    const explicitNoSecret: RunProdAppAuthOptions = {
      admin,
      mail: { baseUrl: "https://app.example.com", hmacSecret: "mail-only-secret" },
      passwordReset: { appUrl: "https://custom.example.com/pw" },
      emailVerification: { appUrl: "https://custom.example.com/verify" },
    };
    const out = resolveAuthMail(explicitNoSecret, "jwt-secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.appUrl).toBe("https://custom.example.com/pw");
    expect(out.passwordReset?.hmacSecret).toBe("mail-only-secret");
    expect(out.emailVerification?.hmacSecret).toBe("mail-only-secret");
  });

  test("explicit passwordReset with its own hmacSecret wins over mail.hmacSecret", () => {
    const explicitOwnSecret: RunProdAppAuthOptions = {
      admin,
      mail: { baseUrl: "https://app.example.com", hmacSecret: "mail-only-secret" },
      passwordReset: { appUrl: "https://custom.example.com/pw", hmacSecret: "app-own-secret" },
    };
    const out = resolveAuthMail(explicitOwnSecret, "jwt-secret", { SMTP_HOST: "localhost" });
    expect(out.passwordReset?.hmacSecret).toBe("app-own-secret");
  });

  test("explicit passwordReset without hmacSecret and no mail block falls back to the call-site secret", () => {
    const explicitNoMail: RunProdAppAuthOptions = {
      admin,
      passwordReset: { appUrl: "https://custom.example.com/pw" },
    };
    const out = resolveAuthMail(explicitNoMail, "jwt-secret", {});
    expect(out.passwordReset?.hmacSecret).toBe("jwt-secret");
  });

  test("explicit passwordReset without hmacSecret is still backfilled when SMTP_HOST is unset", () => {
    const explicitNoSmtp: RunProdAppAuthOptions = {
      admin,
      mail: { baseUrl: "https://app.example.com", hmacSecret: "mail-only-secret" },
      passwordReset: { appUrl: "https://custom.example.com/pw" },
    };
    const out = resolveAuthMail(explicitNoSmtp, "jwt-secret", {});
    expect(out.passwordReset?.hmacSecret).toBe("mail-only-secret");
  });
});
