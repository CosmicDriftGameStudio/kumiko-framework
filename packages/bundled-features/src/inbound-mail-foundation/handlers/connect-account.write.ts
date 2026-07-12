// connect-account — Tenant-Admin verbindet ein Postfach. Legt den
// mail-account-Stream an (aggregateId = random uuid = accountId =
// Secret-Slot-Key für IMAP-Passwort/OAuth-Refresh-Token).
//
// **Was hier NICHT passiert:**
//   - Kein Secret-Write: IMAP-Credentials laufen über den secrets-Pfad,
//     OAuth-Tokens über die generischen /inbound-mail/oauth-Routen —
//     beides VOR bzw. NACH diesem Call, nie durch den Handler-Payload
//     (Plain-Passwörter gehören nicht in einen Write-Payload, der im
//     Dispatcher-Log landen kann).
//   - Kein Verbindungs-Test: der Watch-Supervisor probiert den ersten
//     fetch und schaltet bei Fehler via update-account auf auth_error —
//     der Connect bleibt schnell und offline-fähig (Test-Ergebnis kommt
//     asynchron als Status-Übergang).

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { InboundMailAccountStatuses, InboundMailAuthMethods } from "../constants";
import { MAIL_ACCOUNT_PII_FIELDS, mailAccountEntity } from "../entities";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_CONNECTED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events";

export const connectAccountSchema = z.object({
  /** Provider-Key wie an der Extension registriert ("imap",
   *  "m365-graph", "gmail-rest"). */
  provider: z.string().min(1).max(50),
  authMethod: z.enum([
    InboundMailAuthMethods.password,
    InboundMailAuthMethods.xoauth2,
    InboundMailAuthMethods.oauth,
  ]),
  displayName: z.string().max(200),
  /** Postfach-Adresse, Plaintext — wird hier encrypted. */
  address: z.string().min(1).max(320),
  /** "shared" = tenant-geteilt (info@) · "user" = persönliches Postfach
   *  des Callers (ownerUserId wird aus der Session gezogen, nie aus dem
   *  Payload — kein Fremd-Claiming). */
  scope: z.enum(["shared", "user"]),
  /** NUR für den programmatic OAuth-Callback-Pfad (SystemAdmin): dort
   *  ist der Dispatcher-User ein SystemUser, der echte Owner steht im
   *  HMAC-verifizierten state. Tenant-Caller dürfen das Feld nicht
   *  setzen (Fremd-Claiming-Sperre im Handler). */
  ownerUserIdOverride: z.string().max(36).nullable().optional(),
});
type ConnectAccountPayload = z.infer<typeof connectAccountSchema>;

export const connectAccountHandler: WriteHandlerDef = {
  name: "connect-account",
  schema: connectAccountSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as ConnectAccountPayload;
    const tenantId = event.user.tenantId;
    const accountId = crypto.randomUUID();

    if (payload.ownerUserIdOverride !== undefined && !event.user.roles.includes("SystemAdmin")) {
      return failUnprocessable("owner_override_requires_system_admin");
    }
    const ownerUserId =
      payload.ownerUserIdOverride !== undefined
        ? payload.ownerUserIdOverride
        : payload.scope === "user"
          ? event.user.id
          : null;

    // PII-Encrypt der Adresse vor dem append — einziger Write-Pfad auf
    // den Stream, deckt Event-Log UND Projection ab (#800-Muster).
    const piiKms = configuredPiiSubjectKms();
    const plainPii = { tenantId, address: payload.address };
    const encryptedFields = piiKms
      ? await encryptPiiFieldValues(plainPii, mailAccountEntity, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:connect-account:${accountId}`,
          tenantId,
        })
      : plainPii;

    const eventPayload: MailAccountEventPayload = {
      provider: payload.provider,
      authMethod: payload.authMethod,
      ownerUserId,
      displayName: payload.displayName,
      address: encryptedFields["address"] as string,
      // active ab Connect — der Supervisor greift den Account beim
      // nächsten Tick auf und degradiert ihn bei Credential-Fehlern.
      status: InboundMailAccountStatuses.active,
      watchState: "idle",
    };
    const headers: MailAccountEventHeaders = {
      providerName: payload.provider,
      reason: "connect_flow",
    };
    await ctx.unsafeAppendEvent({
      aggregateId: accountId,
      aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
      type: MAIL_ACCOUNT_CONNECTED_EVENT_QN,
      payload: eventPayload,
      headers,
    });

    return { isSuccess: true as const, data: { accountId } };
  },
};
