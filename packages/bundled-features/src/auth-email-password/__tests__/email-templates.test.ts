// Unit-Tests für die structured token-mail-Renderer (reset + verify).
// Pure-Functions: sie liefern AuthMailContent (subject + header + sections +
// footer), das delivery's renderer-simple zu HTML rendert — Escaping lebt
// dort. Diese Tests prüfen daher die strukturierte Content, nicht HTML.

import { describe, expect, test } from "bun:test";
import type { AuthMailContent } from "../email-templates";
import { renderResetPasswordEmail, renderVerifyEmail } from "../email-templates";

function buttonUrl(content: AuthMailContent): string | undefined {
  for (const section of content.sections) {
    if ("button" in section) return section.button.url;
  }
  return undefined;
}

function textOf(content: AuthMailContent): string {
  return content.sections.map((section) => ("text" in section ? section.text : "")).join(" ");
}

describe("renderResetPasswordEmail", () => {
  const baseArgs = {
    url: "https://acme.example/reset?token=t-abc123",
    expiresAt: "2026-05-04T13:45:00.000Z",
  };

  test("default-locale 'en' + default-appName 'Account'", () => {
    const out = renderResetPasswordEmail(baseArgs);
    expect(out.subject).toBe("Account — Reset your password");
    expect(out.header).toBe("Reset password");
    expect(buttonUrl(out)).toBe(baseArgs.url);
    // expiresAt wird zu human-readable-Format formatiert (UTC-pinned).
    expect(textOf(out)).toContain("2026-05-04 13:45 UTC");
  });

  test("locale 'de' liefert deutsche Subjects + Body", () => {
    const out = renderResetPasswordEmail({ ...baseArgs, locale: "de" });
    expect(out.subject).toContain("Passwort zurücksetzen");
    expect(out.header).toBe("Passwort zurücksetzen");
    expect(textOf(out)).toContain("Hallo");
  });

  test("appName-Override taucht in subject + body auf", () => {
    const out = renderResetPasswordEmail({ ...baseArgs, appName: "PublicStatus", locale: "en" });
    expect(out.subject).toBe("PublicStatus — Reset your password");
    expect(textOf(out)).toContain("PublicStatus");
  });

  test("url kommt unescaped 1:1 durch (renderer-simple escaped beim HTML-Bau)", () => {
    const url = 'https://x.example/?token=t"><script>alert(1)</script>';
    const out = renderResetPasswordEmail({ ...baseArgs, url });
    expect(buttonUrl(out)).toBe(url);
  });

  test("footer trägt die ignore-Reassurance", () => {
    const out = renderResetPasswordEmail(baseArgs);
    expect(out.footer.length).toBeGreaterThan(0);
    expect(out.footer.toLowerCase()).toContain("ignore");
  });
});

describe("renderVerifyEmail", () => {
  const baseArgs = {
    url: "https://acme.example/verify?token=v-abc123",
    expiresAt: "2026-05-04T13:45:00.000Z",
  };

  test("default-locale 'en' + default-appName 'Account'", () => {
    const out = renderVerifyEmail(baseArgs);
    expect(out.subject).toBe("Account — Verify your email");
    expect(out.header).toBe("Verify email");
    expect(buttonUrl(out)).toBe(baseArgs.url);
    expect(textOf(out)).toContain("2026-05-04 13:45 UTC");
  });

  test("locale 'de' liefert deutsche Subjects + Body", () => {
    const out = renderVerifyEmail({ ...baseArgs, locale: "de" });
    expect(out.subject).toContain("E-Mail bestätigen");
    expect(out.header).toBe("E-Mail bestätigen");
    expect(textOf(out)).toContain("Willkommen");
  });

  test("appName-Override im subject", () => {
    const out = renderVerifyEmail({ ...baseArgs, appName: "PublicStatus", locale: "en" });
    expect(out.subject).toBe("PublicStatus — Verify your email");
  });
});

describe("Reset vs Verify haben separate subjects + headers", () => {
  // Sicherheit gegen Copy-Paste-Bugs zwischen den beiden Renderern —
  // die sind strukturell ähnlich, aber subjects + CTA müssen klar
  // unterschiedlich sein damit User die Mails nicht verwechselt.
  const args = { expiresAt: "2026-05-04T13:45:00.000Z" };
  const reset = renderResetPasswordEmail({ ...args, url: "https://x/r" });
  const verify = renderVerifyEmail({ ...args, url: "https://x/v" });
  test("subjects unterscheiden sich", () => {
    expect(reset.subject).not.toBe(verify.subject);
  });
  test("header-CTA unterscheiden sich", () => {
    expect(reset.header).toBe("Reset password");
    expect(verify.header).toBe("Verify email");
  });
});
