// Dispatch logic of the notify-based default mailers: right notification type,
// recipient by userId, locale resolution, tenant-bound notify, delivery failure
// surfaces as a throw. The real render + transport bridge is proven in
// mail-default-bridge.integration.test.ts against the real cron.

import { describe, expect, test } from "bun:test";
import type { NotifyFn, NotifyOptions, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import {
  makeDefaultDeletionExecutedEmail,
  makeDefaultDeletionRequestedEmail,
  makeDefaultExportFailedEmail,
  makeDefaultExportReadyEmail,
} from "../lib/default-mailers.js";
import { GdprMailNotificationTypes } from "../mail-notifications.js";

type NotifyCall = { type: string; options: NotifyOptions };

function capturingNotify(status: "sent" | "failed" = "sent"): {
  notify: NotifyFn;
  calls: NotifyCall[];
} {
  const calls: NotifyCall[] = [];
  const notify: NotifyFn = async (type, options) => {
    calls.push({ type, options });
    return {
      kind: "dispatched",
      deliveries: [
        {
          channel: "email",
          recipientId: "u1",
          status,
          error: status === "failed" ? "send_failed" : null,
        },
      ],
    };
  };
  return { notify, calls };
}

const TENANT_A = "00000000-0000-4000-8000-00000000000a" as TenantId;

registerMailTranslations("de", localeDeBundle);

const exportArgs = {
  userId: "u1",
  userEmail: "u1@example.com",
  tenantId: TENANT_A,
  jobId: "j1",
  downloadUrl: "https://app.test/x?token=tok",
  expiresAt: "2026-07-01T13:45:00Z",
  bytesWritten: 1234,
};

describe("default-mailers dispatch", () => {
  test("export-ready: notifies the user immediately on the recipient tenant with link + formatted expiry", async () => {
    const cap = capturingNotify();
    const tenants: string[] = [];
    const send = makeDefaultExportReadyEmail(
      (tenantId) => {
        tenants.push(tenantId);
        return cap.notify;
      },
      { appName: "Acme" },
    );

    await send({ ...exportArgs, userLocale: "de" });

    expect(tenants).toEqual([TENANT_A]);
    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0]?.type).toBe(GdprMailNotificationTypes.exportReady);
    expect(cap.calls[0]?.options).toMatchObject({
      to: "u1",
      locale: "de",
      immediate: true,
      data: {
        appName: "Acme",
        actionUrl: "https://app.test/x?token=tok",
        validUntil: "2026-07-01 13:45 UTC",
      },
    });
  });

  test("locale precedence: user.locale wins, mailDefaults is the fallback, en is the last resort", async () => {
    const cap = capturingNotify();
    const notifyFor = () => cap.notify;

    await makeDefaultExportReadyEmail(notifyFor, { locale: "de" })({
      ...exportArgs,
      userLocale: "fr",
    });
    await makeDefaultExportReadyEmail(notifyFor, { locale: "de" })({
      ...exportArgs,
      userLocale: null,
    });
    await makeDefaultExportReadyEmail(notifyFor)({ ...exportArgs, userLocale: null });
    await makeDefaultExportReadyEmail(notifyFor, { locale: "en" })({
      ...exportArgs,
      userLocale: "de",
    });

    expect(cap.calls.map((call) => call.options.locale)).toEqual(["de", "de", "en", "de"]);
  });

  test("a failed delivery throws so the best-effort caller sees it", async () => {
    const cap = capturingNotify("failed");
    const send = makeDefaultExportFailedEmail(() => cap.notify);
    await expect(send({ ...exportArgs, userLocale: null, errorMessage: "x" })).rejects.toThrow(
      "send_failed",
    );
  });

  test("deletion-requested: notifies the user with the formatted grace deadline", async () => {
    const cap = capturingNotify();
    await makeDefaultDeletionRequestedEmail(cap.notify, { appName: "Acme" })({
      userId: "u1",
      userEmail: "u1@example.com",
      userLocale: "en",
      tenantId: TENANT_A,
      gracePeriodEnd: "2026-07-30T09:00:00Z",
    });

    expect(cap.calls[0]?.type).toBe(GdprMailNotificationTypes.deletionRequested);
    expect(cap.calls[0]?.options).toMatchObject({
      to: "u1",
      data: { appName: "Acme", deletionDate: "2026-07-30 09:00 UTC" },
    });
  });

  test("deletion-executed orphan (0 memberships): no transport resolved, no mail", async () => {
    let resolverCalled = false;
    const send = makeDefaultDeletionExecutedEmail({
      registry: {} as never,
      db: {} as never,
      resolveTransport: async () => {
        resolverCalled = true;
        throw new Error("must not be called");
      },
      configFor: () => undefined,
    });

    await send({
      userId: "u1",
      userEmail: "u1@example.com",
      userLocale: null,
      tenantIds: [],
      executedAt: "2026-07-30T09:05:00Z",
    });

    expect(resolverCalled).toBe(false);
  });
});
