// Unit-Tests fuer die Dispatch-Logik der Default-Mailer: rendert das richtige
// Template + sendet ueber den aufgeloesten Transport an die User-Email. Die
// echte Job-Lane-Bruecke (configResolver → Transport) wird NICHT hier, sondern
// in mail-default-bridge.integration.test.ts gegen den echten Cron bewiesen —
// ein Fake-Resolver wuerde genau diese Naht ueberspringen.

import { describe, expect, test } from "bun:test";
import type {
  EmailMessage,
  EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  makeDefaultDeletionExecutedEmail,
  makeDefaultExportReadyEmail,
} from "../lib/default-mailers";

function capturingTransport(): { transport: EmailTransport; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    send: async (m) => {
      sent.push(m);
    },
  };
  return { transport, sent };
}

const TENANT_A = "00000000-0000-4000-8000-00000000000a" as TenantId;

describe("default-mailers dispatch", () => {
  test("export-ready: rendert Template + sendet an userEmail ueber tenant-transport", async () => {
    const cap = capturingTransport();
    const resolved: string[] = [];
    // Kein defaults.locale → die per-User-Locale (user.locale="de") muss die
    // Sprache bestimmen. Das ist der Advisor-Befund: en-Default an de-User.
    const send = makeDefaultExportReadyEmail(
      async (tenantId) => {
        resolved.push(tenantId);
        return cap.transport;
      },
      { appName: "Acme" },
    );

    await send({
      userId: "u1",
      userEmail: "u1@example.com",
      userLocale: "de",
      tenantId: TENANT_A,
      jobId: "j1",
      downloadUrl: "https://app.test/x?token=tok",
      expiresAt: "2026-07-01T13:45:00Z",
      bytesWritten: 1234,
    });

    expect(resolved).toEqual([TENANT_A]);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0]?.to).toBe("u1@example.com");
    // user.locale="de" → deutsches Subject, obwohl kein defaults.locale gesetzt.
    expect(cap.sent[0]?.subject).toBe("Acme — Dein Datenexport ist bereit");
    expect(cap.sent[0]?.html).toContain("https://app.test/x?token=tok");
  });

  test("locale precedence: user.locale wins, mailDefaults is fallback for unknown", async () => {
    const cap = capturingTransport();
    const resolve = async () => cap.transport;

    // null user.locale + defaults.locale "en" → English fallback.
    await makeDefaultExportReadyEmail(resolve, { locale: "en", appName: "Acme" })({
      userId: "u1",
      userEmail: "u1@example.com",
      userLocale: null,
      tenantId: TENANT_A,
      jobId: "j1",
      downloadUrl: "u",
      expiresAt: "x",
      bytesWritten: null,
    });
    expect(cap.sent[0]?.subject).toBe("Acme — Your data export is ready");

    // unsupported user.locale "fr" + defaults.locale "de" → falls back to de.
    await makeDefaultExportReadyEmail(resolve, { locale: "de", appName: "Acme" })({
      userId: "u2",
      userEmail: "u2@example.com",
      userLocale: "fr",
      tenantId: TENANT_A,
      jobId: "j2",
      downloadUrl: "u",
      expiresAt: "x",
      bytesWritten: null,
    });
    expect(cap.sent[1]?.subject).toBe("Acme — Dein Datenexport ist bereit");
  });

  test("deletion-executed: sendet ueber den ersten Membership-Tenant", async () => {
    const cap = capturingTransport();
    const resolved: string[] = [];
    const send = makeDefaultDeletionExecutedEmail(async (tenantId) => {
      resolved.push(tenantId);
      return cap.transport;
    });

    await send({
      userId: "u1",
      userEmail: "u1@example.com",
      userLocale: "de",
      tenantIds: [TENANT_A, "00000000-0000-4000-8000-00000000000b" as TenantId],
      executedAt: "2026-07-30T09:05:00Z",
    });

    expect(resolved).toEqual([TENANT_A]);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0]?.to).toBe("u1@example.com");
    expect(cap.sent[0]?.subject).toBe("Konto — Dein Konto wurde geloescht");
  });

  test("deletion-executed orphan (0 Memberships): kein Transport aufgeloest, keine Mail", async () => {
    const cap = capturingTransport();
    let resolverCalled = false;
    const send = makeDefaultDeletionExecutedEmail(async () => {
      resolverCalled = true;
      return cap.transport;
    });

    await send({
      userId: "u1",
      userEmail: "u1@example.com",
      userLocale: null,
      tenantIds: [],
      executedAt: "2026-07-30T09:05:00Z",
    });

    expect(resolverCalled).toBe(false);
    expect(cap.sent).toHaveLength(0);
  });
});
