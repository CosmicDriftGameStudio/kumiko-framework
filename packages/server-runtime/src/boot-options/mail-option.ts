import {
  createChannelEmailFeature,
  createInMemoryTransport,
  createSmtpTransportFromEnv,
  type EmailChannelOptions,
  type EmailTransport,
  type TenantTransportResolver,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { type FeatureDefinition, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";

/** Mounts `channel-email` with an app-wide transport and wires the auth mail
 *  flows (`auth.mail`) to it.
 *  - `"smtp-env"`: SMTP from `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` /
 *    `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`; a missing `SMTP_HOST` aborts the boot.
 *  - `"inmemory"`: keeps mails in memory; refused when `NODE_ENV=production`.
 *  - an `EmailTransport` object: used as is.
 *
 *  @example
 *  runProdApp({ ..., mail: { transport: "smtp-env", from: "Acme <noreply@acme.example>" } })
 */
export type MailRecipientScope = "membership" | "any";

export type MailBootOption = {
  readonly transport: "smtp-env" | "inmemory" | EmailTransport;
  /** Sender when `SMTP_FROM` is unset (`"smtp-env"` only). Default `auth.mail.from`, then `noreply@localhost`. */
  readonly from?: string;
  /** Which users the default resolver reaches from a tenant other than the system tenant.
   *  `"membership"` (default): members of the notifying tenant and SystemAdmins.
   *  `"any"`: every user, whatever tenant notifies. Ignored with a custom `resolveEmail`. */
  readonly recipientScope?: MailRecipientScope;
  /** Maps a user id to the stored email. Default: see `recipientScope`. */
  readonly resolveEmail?: EmailChannelOptions["resolveEmail"];
  /** Per-tenant transport, see `createChannelEmailFeature`. */
  readonly tenantTransport?: TenantTransportResolver;
};

export const CHANNEL_EMAIL_FEATURE = "channel-email";

// channel-email decrypts the returned value itself, so the raw stored column
// (ciphertext under an active KMS) is the right thing to hand back.
// User rows live on SYSTEM_TENANT_ID; the tenant-scoped db still reads them.
// SystemAdmin comes from the recipient's stored global roles, never from the session.
export async function resolveStoredUserEmail(
  userId: string,
  ctx: Parameters<EmailChannelOptions["resolveEmail"]>[1],
  recipientScope: MailRecipientScope = "membership",
): Promise<string | null> {
  const user = await fetchOne<{ email: string; roles: unknown }>(ctx.db, userTable, { id: userId });
  if (!user) return null;
  if (recipientScope === "any" || ctx.tenantId === SYSTEM_TENANT_ID) return user.email;
  const membership = await fetchOne(ctx.db, tenantMembershipsTable, {
    tenantId: ctx.tenantId,
    userId,
  });
  if (membership || parseRoles(user.roles).includes(ROLES.SystemAdmin)) return user.email;
  return null;
}

function buildSmtpEnvTransport(
  envSource: Record<string, string | undefined>,
  fallbackFrom: string,
): EmailTransport {
  if (Boolean(envSource["SMTP_USER"]) !== Boolean(envSource["SMTP_PASS"])) {
    throw new Error(
      '[runProdApp] mail.transport "smtp-env": SMTP_USER and SMTP_PASS must be set together.',
    );
  }
  const transport = createSmtpTransportFromEnv(envSource, { fallbackFrom });
  if (!transport) {
    throw new Error('[runProdApp] mail.transport "smtp-env" needs SMTP_HOST.');
  }
  return transport;
}

export function resolveMailOption(
  mail: MailBootOption,
  deps: {
    readonly envSource: Record<string, string | undefined>;
    readonly isProduction: boolean;
    readonly authMailFrom: string | undefined;
  },
): { readonly feature: FeatureDefinition; readonly transport: EmailTransport } {
  let transport: EmailTransport;
  if (mail.transport === "smtp-env") {
    transport = buildSmtpEnvTransport(
      deps.envSource,
      mail.from ?? deps.authMailFrom ?? "noreply@localhost",
    );
  } else if (mail.transport === "inmemory") {
    if (deps.isProduction) {
      throw new Error(
        '[runProdApp] mail.transport "inmemory" drops every mail — not allowed with NODE_ENV=production.',
      );
    }
    transport = createInMemoryTransport();
  } else {
    transport = mail.transport;
  }
  const feature = createChannelEmailFeature({
    transport,
    resolveEmail:
      mail.resolveEmail ??
      ((userId, ctx) => resolveStoredUserEmail(userId, ctx, mail.recipientScope)),
    ...(mail.tenantTransport && { tenantTransport: mail.tenantTransport }),
  });
  return { feature, transport };
}
