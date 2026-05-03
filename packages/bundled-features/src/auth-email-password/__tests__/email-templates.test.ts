// Unit-Tests für die default-HTML-Renderer der Reset/Verify-Mails.
// Pure-Functions, kein DOM, kein Mail-Versand — nur das Rendering-
// Contract: subject enthält App-Namen, body enthält Reset-URL und
// expiresAt, HTML escaped XSS-Versuche, beide Locales unterscheiden
// sich erwartungsgemäß.

import { describe, expect, test } from "vitest";
import { renderResetPasswordEmail, renderVerifyEmail } from "../email-templates";

describe("renderResetPasswordEmail", () => {
  const baseArgs = {
    resetUrl: "https://acme.example/reset?token=t-abc123",
    expiresAt: "2026-05-04T13:45:00.000Z",
  };

  test("default-locale 'en' + default-appName 'Account'", () => {
    const out = renderResetPasswordEmail(baseArgs);
    expect(out.subject).toBe("Account — Reset your password");
    expect(out.html).toContain("Reset password");
    expect(out.html).toContain(baseArgs.resetUrl);
    // expiresAt wird zu human-readable-Format formatiert (UTC-pinned).
    expect(out.html).toContain("2026-05-04 13:45 UTC");
  });

  test("locale 'de' liefert deutsche Subjects + Body", () => {
    const out = renderResetPasswordEmail({ ...baseArgs, locale: "de" });
    expect(out.subject).toContain("Passwort zurücksetzen");
    expect(out.html).toContain("Passwort zurücksetzen");
    expect(out.html).toContain("Hallo");
  });

  test("appName-Override taucht in subject + body auf", () => {
    const out = renderResetPasswordEmail({ ...baseArgs, appName: "PublicStatus", locale: "en" });
    expect(out.subject).toBe("PublicStatus — Reset your password");
    expect(out.html).toContain("PublicStatus");
  });

  test("escaped potentielle XSS in resetUrl", () => {
    // Ein Angreifer der den resetUrl-input kontrollieren würde, würde
    // sonst HTML-injection im Mail erreichen. Token-Generation ist
    // server-side, aber defense-in-depth schadet nicht.
    const out = renderResetPasswordEmail({
      ...baseArgs,
      resetUrl: 'https://x.example/?token=t"><script>alert(1)</script>',
    });
    expect(out.html).not.toContain("<script>alert");
    expect(out.html).toContain("&quot;");
  });

  test("subject + html sind beide non-empty + html startet mit <!DOCTYPE", () => {
    const out = renderResetPasswordEmail(baseArgs);
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html).toMatch(/^<!DOCTYPE html>/);
  });
});

describe("renderVerifyEmail", () => {
  const baseArgs = {
    verificationUrl: "https://acme.example/verify?token=v-abc123",
    expiresAt: "2026-05-04T13:45:00.000Z",
  };

  test("default-locale 'en' + default-appName 'Account'", () => {
    const out = renderVerifyEmail(baseArgs);
    expect(out.subject).toBe("Account — Verify your email");
    expect(out.html).toContain("Verify email");
    expect(out.html).toContain(baseArgs.verificationUrl);
    expect(out.html).toContain("2026-05-04 13:45 UTC");
  });

  test("locale 'de' liefert deutsche Subjects + Body", () => {
    const out = renderVerifyEmail({ ...baseArgs, locale: "de" });
    expect(out.subject).toContain("E-Mail bestätigen");
    expect(out.html).toContain("E-Mail bestätigen");
    expect(out.html).toContain("Willkommen");
  });

  test("appName-Override im subject", () => {
    const out = renderVerifyEmail({ ...baseArgs, appName: "PublicStatus", locale: "en" });
    expect(out.subject).toBe("PublicStatus — Verify your email");
  });

  test("escaped XSS in verificationUrl", () => {
    const out = renderVerifyEmail({
      ...baseArgs,
      verificationUrl: 'https://x.example/?token=v"><script>alert(1)</script>',
    });
    expect(out.html).not.toContain("<script>alert");
  });
});

describe("Reset vs Verify haben separate subjects + body-Texte", () => {
  // Sicherheit gegen Copy-Paste-Bugs zwischen den beiden Renderern —
  // die sind strukturell ähnlich, aber subjects + body-Intros müssen
  // klar unterschiedlich sein damit User die Mails nicht verwechselt.
  const args = { expiresAt: "2026-05-04T13:45:00.000Z" };
  const reset = renderResetPasswordEmail({ ...args, resetUrl: "https://x/r" });
  const verify = renderVerifyEmail({ ...args, verificationUrl: "https://x/v" });
  test("subjects unterscheiden sich", () => {
    expect(reset.subject).not.toBe(verify.subject);
  });
  test("button-labels unterscheiden sich", () => {
    expect(reset.html).toContain("Reset password");
    expect(verify.html).toContain("Verify email");
  });
});
