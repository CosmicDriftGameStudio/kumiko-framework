// Initial values of the reconnect form: the server settings of the stored credential, never the
// password. A missing or unreadable credential leaves the fields empty for the admin to fill in.

import {
  type InboundMailRoles,
  inboundCredentialSecretKey,
  mayReactivateMailbox,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { FEATURE_NAME } from "./constants.ts";
import { parseImapCredentialDocument } from "./credential-document.ts";
import { findReconnectableAccount } from "./reconnect-account.ts";

const reconnectPrefillSchema = z.object({ accountId: z.uuid() }).strict();

export const createReconnectPrefillQuery = ({
  memberRoles,
  adminRoles,
}: InboundMailRoles): QueryHandlerDef => ({
  name: "reconnect-prefill",
  schema: reconnectPrefillSchema,
  access: { roles: [...memberRoles] },
  // Only the reconnect form needs these settings; the agent has no write to use them with.
  agent: { expose: false },
  description:
    "Returns the server settings (IMAP host and port, user name, SMTP host and port, trusted authserv-id) stored for a password IMAP mailbox without its password, or null when the mailbox is not found or not a password IMAP mailbox; use it to prefill the reconnect form.",
  handler: async (query, ctx) => {
    const { accountId } = reconnectPrefillSchema.parse(query.payload);
    const lookup = await findReconnectableAccount(ctx.db, accountId);
    // Same null as for a missing account: a caller who may not reconnect it learns nothing about it.
    if (!lookup.isSuccess || !mayReactivateMailbox(lookup.row.ownerUserId, ctx.user, adminRoles)) {
      return null;
    }

    const secrets = requireSecretsContext(
      { secrets: ctx.services.secrets, user: ctx.user },
      FEATURE_NAME,
    );
    const stored = await secrets.get(ctx.user.tenantId, inboundCredentialSecretKey(accountId));
    const parsed = stored ? parseImapCredentialDocument(stored.reveal()) : undefined;
    const displayName = lookup.row.displayName ?? "";
    const trustedAuthservId = lookup.row.trustedAuthservId ?? "";
    if (!parsed?.ok) return { accountId, displayName, trustedAuthservId };
    const { host, port, user, smtpHost, smtpPort } = parsed.doc;
    return { accountId, displayName, host, port, user, smtpHost, smtpPort, trustedAuthservId };
  },
});
