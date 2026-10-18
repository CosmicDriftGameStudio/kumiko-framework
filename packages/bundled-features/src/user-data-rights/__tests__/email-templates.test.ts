import { describe, expect, test } from "bun:test";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { formatGdprMailTimestamp } from "../email-templates.ts";
import {
  GdprMailNotificationTypes,
  gdprMailLocalizedTemplate,
  gdprMailTemplateLocale,
} from "../mail-notifications.ts";

registerMailTranslations("de", localeDeBundle);

describe("gdpr mail templates", () => {
  test("export-ready: subject keeps the appName slot, body has the link slot and button", () => {
    const template = gdprMailLocalizedTemplate("exportReady")();
    expect(template["en"]?.meta.subject).toBe("{{appName}} — Your data export is ready");
    expect(template["en"]?.body).toContain('href="{{actionUrl}}"');
    expect(template["en"]?.body).toContain("Download data export");
    expect(template["en"]?.body).toContain('data-variable="validUntil"');
    expect(template["de"]?.meta.subject).toBe("{{appName}} — Dein Datenexport ist bereit");
  });

  test("export-failed: informational, no link", () => {
    const template = gdprMailLocalizedTemplate("exportFailed")();
    expect(template["en"]?.body).not.toContain("<a ");
    expect(template["en"]?.body).toContain("request the export again");
  });

  test("deletion-requested and -executed carry their date slots", () => {
    expect(gdprMailLocalizedTemplate("deletionRequested")()["en"]?.body).toContain(
      'data-variable="deletionDate"',
    );
    expect(gdprMailLocalizedTemplate("deletionExecuted")()["de"]?.body).toContain(
      'data-variable="executedAt"',
    );
  });

  test("a locale without its own subject key gets no template and the sender falls back to en", () => {
    expect(gdprMailTemplateLocale(GdprMailNotificationTypes.exportReady, "de")).toBe("de");
    expect(gdprMailTemplateLocale(GdprMailNotificationTypes.exportReady, "xx")).toBe("en");
  });
});

describe("formatGdprMailTimestamp", () => {
  test("formats an instant in UTC", () => {
    expect(formatGdprMailTimestamp("2026-07-01T13:45:00Z")).toBe("2026-07-01 13:45 UTC");
  });

  test("falls back to the raw string when unparsable", () => {
    expect(formatGdprMailTimestamp("not-a-date")).toBe("not-a-date");
  });
});
