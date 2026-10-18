// Default send*Email callbacks for the GDPR notifications. The app writes no
// callback code: it mounts delivery + channel-email (+ the template stack) and
// sets appExportDownloadUrl for export mails. Own send*Email options win over
// these defaults (opt-override in feature.ts).
//
// Export-ready/-failed and deletion-requested go through ctx.notify addressed
// to the user, so delivery resolves the address and the attempt row carries
// the recipientId the forget path erases. Deletion-executed cannot: the user
// is gone by then, and an attempt row written after the erasure would be new
// personal data. It renders the seeded template and sends it straight through the
// email channel (or, without one, the tenant's mail transport), with no delivery log.

import type { EmailTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { MAIL_TRANSPORT_EXTENSION } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigAccessor,
  NotifyFn,
  NotifyOptions,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { hasMailTranslations, mailT } from "@cosmicdrift/kumiko-framework/i18n";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import {
  buildChannelContext,
  collectChannels,
  DELIVERY_CHANNEL_EXTENSION,
  type DeliveryChannel,
  EMAIL_CHANNEL_NAME,
} from "../../delivery/index.js";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
} from "../../renderer-foundation/index.js";
import {
  formatGdprMailTimestamp,
  type GdprMailLocale,
  normalizeGdprMailLocale,
} from "../email-templates.js";
import type { SendDeletionRequestedEmailFn } from "../handlers/request-deletion.write.js";
import { GdprMailNotificationTypes, gdprMailTemplateLocale } from "../mail-notifications.js";
import type { SendExportFailedEmailFn, SendExportReadyEmailFn } from "../run-export-jobs.js";
import type { SendDeletionExecutedEmailFn } from "../run-forget-cleanup.js";

export type GdprMailDefaults = {
  readonly locale?: GdprMailLocale;
  readonly appName?: string;
};

// The notify-based defaults need the delivery pipeline with an email channel.
export function isGdprMailDeliveryAvailable(registry: Registry): boolean {
  return registry
    .getExtensionUsages(DELIVERY_CHANNEL_EXTENSION)
    .some((usage) => usage.entityName === "email");
}

export function isMailTransportAvailable(registry: Registry): boolean {
  return registry.getExtensionUsages(MAIL_TRANSPORT_EXTENSION).length > 0;
}

export function isMailRendererAvailable(registry: Registry): boolean {
  return collectRendererPlugins(registry).some((plugin) => plugin.kinds.includes("mail"));
}

export type NotifyForTenant = (tenantId: TenantId) => NotifyFn;

// Per-recipient locale wins (user.locale); mailDefaults.locale is the fallback
// for unknown/unsupported user.locale values; a locale without a template for
// this notification falls back to en.
function mailLocaleFor(
  notificationType: string,
  userLocale: string | null,
  defaults: GdprMailDefaults,
): string {
  const user = normalizeGdprMailLocale(userLocale);
  const preferred = user !== undefined && hasMailTranslations(user) ? user : defaults.locale;
  return gdprMailTemplateLocale(notificationType, preferred ?? "en");
}

function appNameFor(locale: string, defaults: GdprMailDefaults): string {
  return defaults.appName ?? mailT(locale, "gdpr.mail.appNameDefault");
}

// Delivery failures come back as results, not throws; the callers' best-effort
// handling only sees them if they throw.
async function notifyImmediately(
  notify: NotifyFn,
  notificationType: string,
  options: NotifyOptions,
): Promise<void> {
  const result = await notify(notificationType, { ...options, immediate: true });
  const failed = result.deliveries.find((delivery) => delivery.status === "failed");
  if (failed) {
    throw new Error(`${notificationType} delivery failed: ${failed.error ?? "unknown"}`);
  }
}

export function makeDefaultExportReadyEmail(
  notifyFor: NotifyForTenant,
  defaults: GdprMailDefaults = {},
): SendExportReadyEmailFn {
  return async (args) => {
    const type = GdprMailNotificationTypes.exportReady;
    const locale = mailLocaleFor(type, args.userLocale, defaults);
    // immediate: the plain magic-link token must not land in a delivery job payload.
    await notifyImmediately(notifyFor(args.tenantId), type, {
      to: args.userId,
      locale,
      data: {
        appName: appNameFor(locale, defaults),
        actionUrl: args.downloadUrl,
        validUntil: formatGdprMailTimestamp(args.expiresAt),
      },
    });
  };
}

export function makeDefaultExportFailedEmail(
  notifyFor: NotifyForTenant,
  defaults: GdprMailDefaults = {},
): SendExportFailedEmailFn {
  return async (args) => {
    const type = GdprMailNotificationTypes.exportFailed;
    const locale = mailLocaleFor(type, args.userLocale, defaults);
    await notifyImmediately(notifyFor(args.tenantId), type, {
      to: args.userId,
      locale,
      data: { appName: appNameFor(locale, defaults) },
    });
  };
}

export function makeDefaultDeletionRequestedEmail(
  notify: NotifyFn,
  defaults: GdprMailDefaults = {},
): SendDeletionRequestedEmailFn {
  return async (args) => {
    const type = GdprMailNotificationTypes.deletionRequested;
    const locale = mailLocaleFor(type, args.userLocale, defaults);
    await notify(type, {
      to: args.userId,
      locale,
      data: {
        appName: appNameFor(locale, defaults),
        deletionDate: formatGdprMailTimestamp(args.gracePeriodEnd),
      },
    });
  };
}

export type DeletionExecutedMailDeps = {
  readonly registry: Registry;
  readonly db: DbConnection;
  /** Used only when no email delivery channel is mounted. */
  readonly resolveTransport: (tenantId: string) => Promise<EmailTransport>;
  readonly configFor: (tenantId: TenantId) => ConfigAccessor | undefined;
  readonly secrets?: SecretsContext;
};

function emailChannelOf(registry: Registry): DeliveryChannel | undefined {
  return collectChannels(registry).find((channel) => channel.name === EMAIL_CHANNEL_NAME);
}

export function makeDefaultDeletionExecutedEmail(
  deps: DeletionExecutedMailDeps,
  defaults: GdprMailDefaults = {},
): SendDeletionExecutedEmailFn {
  return async (args) => {
    // Der User ist global, der Mail-Transport per-Tenant — wir senden ueber den
    // Transport des ersten Memberships. Orphan-User (0 Memberships) liefert
    // keine Tenant-Identitaet → kein Transport aufloesbar, Mail entfaellt.
    const tenantId = args.tenantIds[0];
    if (tenantId === undefined) {
      // skip: orphan user has no tenant whose transport could send the mail
      return;
    }
    const type = GdprMailNotificationTypes.deletionExecuted;
    const locale = mailLocaleFor(type, args.userLocale, defaults);
    const plugin = createRendererFoundationApi(
      collectRendererPlugins(deps.registry),
    ).createRendererForTenant({ tenantId, kind: "mail" });
    const config = deps.configFor(tenantId);
    const rendered = await plugin.render(
      {
        kind: "mail",
        payload: {
          slug: type,
          locale,
          variables: {
            appName: appNameFor(locale, defaults),
            executedAt: formatGdprMailTimestamp(args.executedAt),
          },
        },
      },
      {
        db: deps.db,
        registry: deps.registry,
        tenantId,
        ...(config !== undefined && { config }),
      },
    );
    if (rendered.kind !== "mail") {
      throw new Error(`deletion-executed mail: renderer answered with kind "${rendered.kind}"`);
    }
    // The channel picks the same transport as every other mail of this notification
    // (the app transport unless it is declared tenantTransport), so a tenant without
    // its own mail provider still gets the confirmation. channel.send writes no attempt row.
    const channel = emailChannelOf(deps.registry);
    if (channel !== undefined) {
      const result = await channel.send(
        args.userEmail,
        {
          notificationType: type,
          title: rendered.subject,
          body: undefined,
          data: undefined,
          locale,
        },
        buildChannelContext(deps.db, deps.registry, undefined, tenantId, deps.secrets, config),
        { subject: rendered.subject, html: rendered.html, text: rendered.text },
      );
      if (result.status !== "sent") {
        // No address in the message: the user is already erased.
        throw new Error(`deletion-executed mail not sent: ${result.error ?? result.status}`);
      }
      // skip: the channel delivered it, the transport fallback below is for apps without one
      return;
    }
    const transport = await deps.resolveTransport(tenantId);
    await transport.send({
      to: args.userEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  };
}
