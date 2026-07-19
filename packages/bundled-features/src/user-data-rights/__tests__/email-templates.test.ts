import { describe, expect, test } from "bun:test";
import {
  renderDeletionExecutedEmail,
  renderDeletionRequestedEmail,
  renderExportFailedEmail,
  renderExportReadyEmail,
} from "../email-templates";

describe("gdpr email-templates", () => {
  test("export-ready: subject + download-button + formatted expiry, de/en differ", () => {
    const en = renderExportReadyEmail({
      downloadUrl: "https://app.test/export/by-token?token=abc123",
      expiresAt: "2026-07-01T13:45:00Z",
      locale: "en",
      appName: "Acme",
    });
    expect(en.subject).toBe("Acme — Your data export is ready");
    expect(en.html).toContain("https://app.test/export/by-token?token=abc123");
    // Button label present.
    expect(en.html).toContain("Download data export");
    // Instant formatted to UTC, not the raw ISO.
    expect(en.html).toContain("2026-07-01 13:45 UTC");

    const de = renderExportReadyEmail({
      downloadUrl: "https://app.test/x?token=abc",
      expiresAt: "2026-07-01T13:45:00Z",
      locale: "de",
      appName: "Acme",
    });
    expect(de.subject).toBe("Acme — Dein Datenexport ist bereit");
    expect(de.subject).not.toBe(en.subject);
  });

  test("export-ready: html lang attribute matches the requested locale (654/1)", () => {
    const de = renderExportReadyEmail({
      downloadUrl: "https://app.test/x?token=abc",
      expiresAt: "2026-07-01T13:45:00Z",
      locale: "de",
    });
    expect(de.html).toContain('<html lang="de">');
    const en = renderExportReadyEmail({
      downloadUrl: "https://app.test/x?token=abc",
      expiresAt: "2026-07-01T13:45:00Z",
      locale: "en",
    });
    expect(en.html).toContain('<html lang="en">');
  });

  test("export-ready: ampersand in download url is escaped in the href attr", () => {
    const r = renderExportReadyEmail({
      downloadUrl: "https://app.test/x?token=a&next=b",
      expiresAt: "2026-07-01T13:45:00Z",
    });
    // escapeHtmlAttr turns & into &amp; — no raw unescaped attribute break.
    expect(r.html).toContain("token=a&amp;next=b");
    expect(r.html).not.toContain('token=a&next="');
  });

  test("export-ready: default appName when omitted (Account/Konto)", () => {
    expect(
      renderExportReadyEmail({ downloadUrl: "u", expiresAt: "x", locale: "en" }).subject,
    ).toContain("Account");
    expect(
      renderExportReadyEmail({ downloadUrl: "u", expiresAt: "x", locale: "de" }).subject,
    ).toContain("Konto");
  });

  test("export-failed: informational, no download button", () => {
    const r = renderExportFailedEmail({ locale: "en", appName: "Acme" });
    expect(r.subject).toBe("Acme — Your data export failed");
    expect(r.html).not.toContain("<a ");
    expect(r.html).toContain("request the export again");
  });

  test("deletion-requested: grace deadline formatted + cancel hint", () => {
    const r = renderDeletionRequestedEmail({
      gracePeriodEnd: "2026-07-30T09:00:00Z",
      locale: "en",
      appName: "Acme",
    });
    expect(r.subject).toBe("Acme — Account deletion requested");
    expect(r.html).toContain("2026-07-30 09:00 UTC");
    expect(r.html).toContain("cancel the deletion");
  });

  test("deletion-executed: execution timestamp formatted", () => {
    const r = renderDeletionExecutedEmail({
      executedAt: "2026-07-30T09:05:00Z",
      locale: "de",
      appName: "Acme",
    });
    expect(r.subject).toBe("Acme — Dein Konto wurde geloescht");
    expect(r.html).toContain("2026-07-30 09:05 UTC");
  });

  test("un-parsable timestamp falls back to the raw string", () => {
    const r = renderDeletionExecutedEmail({ executedAt: "not-a-date" });
    expect(r.html).toContain("not-a-date");
  });
});
