// reconnect-mailbox: new credentials for an existing password IMAP mailbox, typically after the
// account went to auth_error. The login is checked before the transaction opens; only then the
// credential secret of the same account is overwritten and the account goes back to active (also from disconnected), both
// on the request transaction, so a failure leaves status and secret as they were.

import {
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  type BeforeTransactionResult,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  CREDENTIAL_PREVIEW,
  checkMailboxLogin,
  connectMailboxSchema,
  credentialDocumentOf,
} from "./connect-mailbox.ts";
import { findReconnectableAccount } from "./reconnect-account.ts";

const reconnectMailboxSchema = connectMailboxSchema
  .pick({
    host: true,
    port: true,
    user: true,
    password: true,
    smtpHost: true,
    smtpPort: true,
    trustedAuthservId: true,
  })
  .extend({ accountId: z.uuid() });

const SECRET_TRANSACTION_REASON =
  "the credential secret is written on the request transaction so a failed reconnect rolls the account status back too";

export const reconnectMailboxHandler = defineWriteHandler({
  name: "reconnect-mailbox",
  description:
    "Replaces the credentials of an existing password IMAP mailbox: checks the IMAP login and the SMTP login of the outgoing server first, then overwrites the credential secret of the same account and sets it back to active, keeping its threads and sync cursor.",
  // The payload carries the plaintext password: as a tool call it would reach the model provider.
  agent: { expose: false },
  schema: reconnectMailboxSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  // Same cap as connect: each call opens a connection to a host the caller picks.
  rateLimit: { per: "tenant+handler", limit: 10, windowSeconds: 600 },
  escapeHatch: { grants: ["unsafeRaw"], reason: SECRET_TRANSACTION_REASON },
  beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<null>> => {
    const lookup = await findReconnectableAccount(ctx.db, event.payload.accountId);
    if (!lookup.isSuccess) return lookup;
    return checkMailboxLogin(credentialDocumentOf(event.payload), ctx.obs.log);
  },
  handler: async (event, ctx) => {
    const { accountId } = event.payload;
    // Secret first: reactivate from disconnected requires the credential to exist.
    const secrets = requireSecretsContext(
      { secrets: ctx.services.secrets, user: ctx.user },
      "reconnect-mailbox",
    ).withRunner(ctx.db.unsafeRaw());
    await secrets.set(
      event.user.tenantId,
      inboundCredentialSecretKey(accountId),
      JSON.stringify(credentialDocumentOf(event.payload)),
      {
        redact: () => CREDENTIAL_PREVIEW,
        hint: `IMAP credentials for inbound mail account ${accountId}`,
        updatedBy: event.user.id,
      },
    );
    const reactivated = await ctx.dispatch.write(InboundMailFoundationHandlers.reactivateAccount, {
      accountId,
    });
    if (!reactivated.isSuccess) return reactivated;
    // The form shows the stored id, so an empty field means the admin cleared it.
    const trusted = await ctx.dispatch.write(InboundMailFoundationHandlers.setTrustedAuthservId, {
      accountId,
      trustedAuthservId: event.payload.trustedAuthservId ?? null,
    });
    if (!trusted.isSuccess) return trusted;
    return { isSuccess: true, data: { accountId } };
  },
});
