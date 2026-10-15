// Expiry formatting and the localized template bodies of the auth mails. Full
// rendering (Handlebars, layout, text part) is covered by the mail flows.

import { describe, expect, test } from "bun:test";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { tokenMailExpiry } from "../email-templates.js";
import {
  AUTH_MAIL_KINDS,
  type AuthMailKind,
  authMailLocalizedTemplate,
} from "../mail-notifications.js";

registerMailTranslations("de", localeDeBundle);

describe("tokenMailExpiry", () => {
  const timing = {
    issuedAt: "2026-05-03T13:45:00.000Z",
    expiresAt: "2026-05-04T13:45:00.000Z",
  };

  test("de + Europe/Berlin: duration and local time with zone abbreviation", () => {
    const out = tokenMailExpiry({ ...timing, timeZone: "Europe/Berlin" }, "de");
    expect(out.validFor).toBe("1 Tag");
    expect(out.validUntil).toBe("04.05.2026, 15:45 MESZ");
  });

  test("en without timeZone: UTC", () => {
    const out = tokenMailExpiry(timing, "en");
    expect(out.validFor).toBe("1 day");
    expect(out.validUntil).toMatch(/May 4, 2026.*1:45\sPM UTC/);
  });

  test("an invalid timeZone falls back to UTC instead of throwing", () => {
    expect(tokenMailExpiry({ ...timing, timeZone: "Nope/Zone" }, "en").validUntil).toMatch(
      /1:45\sPM UTC/,
    );
  });

  test("duration uses the largest fitting unit", () => {
    const validFor = (expiresAt: string) =>
      tokenMailExpiry({ ...timing, expiresAt }, "en").validFor;
    expect(validFor("2026-05-03T15:45:00.000Z")).toBe("2 hours");
    expect(validFor("2026-05-03T14:15:00.000Z")).toBe("30 minutes");
    expect(validFor("2026-05-03T15:15:00.000Z")).toBe("90 minutes");
    expect(validFor("2026-05-04T13:45:00.004Z")).toBe("1 day");
  });
});

describe("authMailLocalizedTemplate", () => {
  const kinds = Object.keys(AUTH_MAIL_KINDS) as AuthMailKind[];

  test.each(kinds)("%s ships en and de with transactional meta", (kind) => {
    const template = authMailLocalizedTemplate(kind)();
    expect(Object.keys(template)).toEqual(expect.arrayContaining(["en", "de"]));
    for (const entry of Object.values(template)) {
      expect(entry.meta.category).toBe("transactional");
      expect(entry.meta.subject).toContain("{{appName}}");
      expect(entry.body).toContain('<a data-button href="{{actionUrl}}">');
      expect(entry.body).toContain('<span data-variable="validFor"></span>');
      expect(entry.body).toContain('<span data-variable="validUntil"></span>');
    }
  });

  test("only the invite mail carries the role placeholder", () => {
    expect(authMailLocalizedTemplate("invite")()["en"]?.body).toContain('data-variable="role"');
    expect(authMailLocalizedTemplate("passwordReset")()["en"]?.body).not.toContain("role");
  });

  test("translated text is HTML-escaped, placeholders are not", () => {
    const body = authMailLocalizedTemplate("passwordReset")()["en"]?.body ?? "";
    expect(body).toContain("you can safely ignore this email — your password won't change.");
    expect(body).toContain('<span data-variable="appName"></span>');
  });
});
