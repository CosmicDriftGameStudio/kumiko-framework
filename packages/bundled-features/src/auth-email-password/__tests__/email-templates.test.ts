// Unit-Tests für die structured token-mail-Renderer (reset + verify).
// Pure-Functions: sie liefern AuthMailContent (subject + header + sections +
// footer), das delivery's renderer-simple zu HTML rendert — Escaping lebt
// dort. Diese Tests prüfen daher die strukturierte Content, nicht HTML.

import { describe, expect, test } from "bun:test";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import type { AuthMailContent } from "../email-templates.js";
import {
  renderActivationEmail,
  renderInviteEmail,
  renderResetPasswordEmail,
  renderUnlockAccountEmail,
  renderVerifyEmail,
} from "../email-templates.js";

function buttonUrl(content: AuthMailContent): string | undefined {
  for (const section of content.sections) {
    if ("button" in section) return section.button.url;
  }
  return undefined;
}

function textOf(content: AuthMailContent): string {
  return content.sections.map((section) => ("text" in section ? section.text : "")).join(" ");
}

registerMailTranslations("de", localeDeBundle);

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
    // Without a timeZone the expiry is formatted in UTC.
    expect(textOf(out)).toMatch(/May 4, 2026.*1:45\sPM UTC/);
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
    expect(textOf(out)).toMatch(/May 4, 2026.*1:45\sPM UTC/);
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

describe("expiry sentence", () => {
  const args = {
    url: "https://acme.example/reset?token=t",
    issuedAt: "2026-05-03T13:45:00.000Z",
    expiresAt: "2026-05-04T13:45:00.000Z",
  };

  test("de + Europe/Berlin: duration and local time with zone abbreviation", () => {
    const text = textOf(
      renderResetPasswordEmail({ ...args, locale: "de", timeZone: "Europe/Berlin" }),
    );
    expect(text).toContain("Der Link ist 1 Tag gültig");
    expect(text).toContain("04.05.2026, 15:45 MESZ");
  });

  test("en without timeZone: UTC", () => {
    const text = textOf(renderResetPasswordEmail(args));
    expect(text).toContain("The link is valid for 1 day");
    expect(text).toMatch(/May 4, 2026.*1:45\sPM UTC/);
  });

  test("an invalid timeZone falls back to UTC instead of throwing", () => {
    const text = textOf(renderResetPasswordEmail({ ...args, timeZone: "Nope/Zone" }));
    expect(text).toMatch(/1:45\sPM UTC/);
  });

  test("duration uses the largest fitting unit", () => {
    const hours = textOf(
      renderResetPasswordEmail({ ...args, expiresAt: "2026-05-03T15:45:00.000Z" }),
    );
    expect(hours).toContain("valid for 2 hours");
    const minutes = textOf(
      renderResetPasswordEmail({ ...args, expiresAt: "2026-05-03T14:15:00.000Z" }),
    );
    expect(minutes).toContain("valid for 30 minutes");
    const ninetyMinutes = textOf(
      renderResetPasswordEmail({ ...args, expiresAt: "2026-05-03T15:15:00.000Z" }),
    );
    expect(ninetyMinutes).toContain("valid for 90 minutes");
    const dayPlusJitter = textOf(
      renderResetPasswordEmail({ ...args, expiresAt: "2026-05-04T13:45:00.004Z" }),
    );
    expect(dayPlusJitter).toContain("valid for 1 day");
  });

  test("all five renderers carry the duration sentence", () => {
    const contents = [
      renderResetPasswordEmail(args),
      renderVerifyEmail(args),
      renderActivationEmail(args),
      renderUnlockAccountEmail(args),
      renderInviteEmail({ ...args, role: "Member" }),
    ];
    for (const content of contents) {
      expect(textOf(content)).toContain("The link is valid for 1 day (until ");
    }
  });
});
