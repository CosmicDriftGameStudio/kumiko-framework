// connect-my-mailbox: a member connects a personal password IMAP mailbox (owner = the caller).
// Same login check and secret write as connect-mailbox; the sender-check policy is tenant-wide and
// stays with the admin form.

import {
  InboundMailConnectErrors,
  type InboundMailRoles,
  isOwnLoginAddress,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { UserQueries } from "@cosmicdrift/kumiko-bundled-features/user";
import { createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  checkMailboxLogin,
  connectMailboxSchema,
  connectPasswordMailbox,
  credentialDocumentOf,
  SECRET_TRANSACTION_REASON,
} from "./connect-mailbox.ts";

const connectMyMailboxSchema = connectMailboxSchema.omit({ trustedAuthservId: true });

const MY_MAILBOX_ESCAPE_REASON = `${SECRET_TRANSACTION_REASON}; the account is created with writeAs(system) on connect-account, which is admin-only, and the owner comes from the caller's session; beforeTransaction reads the caller's own login address with a system queryAs(user findForAuth)`;

export const createConnectMyMailboxHandler = ({ memberRoles }: InboundMailRoles) =>
  defineWriteHandler({
    name: "connect-my-mailbox",
    description:
      "Connects a personal IMAP mailbox of the caller with a password over implicit TLS; the address must be the email address of the caller's own account (compared case-insensitively), other addresses are connected by an admin as a shared mailbox. Checks the IMAP login and the SMTP login of the outgoing server first, then creates the mail account owned by the caller and stores both servers, user and password as its credential secret in one step. A disconnected personal mailbox of the caller with the same address is reactivated under its old account id.",
    // The payload carries the plaintext password: as a tool call it would reach the model provider.
    agent: { expose: false },
    schema: connectMyMailboxSchema,
    access: { roles: [...memberRoles] },
    // Each call opens a connection to a host the caller picks; per user, because any member may call it.
    rateLimit: { per: "user", limit: 10, windowSeconds: 600 },
    // connect-account is admin-only; the personal mailbox is created through the system identity. The owner
    // is always event.user.id from the session, never a payload field.
    escapeHatch: { grants: ["unsafeRaw", "systemIdentity"], reason: MY_MAILBOX_ESCAPE_REASON },
    // Before the login check, so a foreign address never makes us contact the payload's host.
    beforeTransaction: async (event, ctx) => {
      const ownUser = await ctx.dispatch.queryAs(
        createSystemUser(event.user.tenantId),
        UserQueries.findForAuth,
        { id: event.user.id },
      );
      if (!(await isOwnLoginAddress(ownUser, event.payload.address))) {
        const { reason, i18nKey } = InboundMailConnectErrors.personalAddressNotOwn;
        return writeFailure(new UnprocessableError(reason, { i18nKey }));
      }
      return checkMailboxLogin(credentialDocumentOf(event.payload), ctx);
    },
    handler: async (event, ctx) => {
      const { displayName, address } = event.payload;
      return connectPasswordMailbox(
        "connect-my-mailbox",
        event,
        ctx,
        { displayName, address, credentialDocument: credentialDocumentOf(event.payload) },
        "user",
      );
    },
  });
