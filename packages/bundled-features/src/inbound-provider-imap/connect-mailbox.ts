// connect-mailbox: the form path for a password IMAP mailbox. The login is checked before the
// transaction opens; only then the account stream and its credential secret are written, both on
// the request transaction, so a failure leaves neither behind.

import {
  InboundAuthError,
  InboundMailAuthMethods,
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  type BeforeTransactionResult,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { IMAP_CONNECT_ERRORS, IMAP_PROVIDER_KEY } from "./constants.ts";
import {
  type ImapCredentialDocument,
  imapCredentialDocumentSchema,
} from "./credential-document.ts";
import { connectOnce, IMAP_HOST_UNREACHABLE_MESSAGE } from "./imap-client.ts";

const connectMailboxSchema = imapCredentialDocumentSchema
  .pick({ host: true, port: true, secure: true, user: true })
  .extend({
    displayName: z.string().min(1).max(200),
    address: z.email().max(320),
    password: z.string().min(1).max(1000),
  });
type ConnectMailboxPayload = z.infer<typeof connectMailboxSchema>;

const connectedAccountSchema = z.object({ accountId: z.string() });

// Matched on the mapped error text, which also carries the host, so only markers no host name
// contains: a bare "tls" or "ssl" would misread a host like ssl.example.com.
const TLS_FAILURE = /certificate|self[- ]signed|wrong version number|EPROTO|ERR_SSL|ERR_TLS/i;

// A fixed preview: any slice of the JSON document would expose the host or the user.
const CREDENTIAL_PREVIEW = "IMAP login";

const SECRET_TRANSACTION_REASON =
  "the credential secret is written on the request transaction so a failed account connect rolls it back too";

function credentialDocumentOf(payload: ConnectMailboxPayload): ImapCredentialDocument {
  const { host, port, secure, user, password } = payload;
  return { host, port, secure, user, password };
}

// The raw error carries the host and the server response; the tenant only gets the category.
// A blocked host and an unresolvable one share one text on purpose (see createImapClient).
function connectFailureOf(err: unknown): keyof typeof IMAP_CONNECT_ERRORS {
  const message = err instanceof Error ? err.message : "";
  if (message === IMAP_HOST_UNREACHABLE_MESSAGE) return "hostUnreachable";
  if (err instanceof InboundAuthError) return "loginRejected";
  if (TLS_FAILURE.test(message)) return "tlsFailed";
  return "connectFailed";
}

export const connectMailboxHandler = defineWriteHandler({
  name: "connect-mailbox",
  description:
    "Connects a shared IMAP mailbox with a password: checks the login against the server first, then creates the mail account and stores host, port, TLS, user and password as its credential secret in one step.",
  // The payload carries the plaintext password: as a tool call it would reach the model provider.
  agent: { expose: false },
  schema: connectMailboxSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  // Each call opens a connection to a host the caller picks; the cap keeps the form from being
  // used to scan ports or to guess passwords at someone else's mail server.
  rateLimit: { per: "tenant+handler", limit: 10, windowSeconds: 600 },
  escapeHatch: { grants: ["unsafeRaw"], reason: SECRET_TRANSACTION_REASON },
  beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<null>> => {
    try {
      await connectOnce(credentialDocumentOf(event.payload), true);
    } catch (err) {
      const { reason, i18nKey } = IMAP_CONNECT_ERRORS[connectFailureOf(err)];
      ctx.obs.log.warn("imap connect check failed", { reason });
      return writeFailure(new UnprocessableError(reason, { i18nKey }));
    }
    return { isSuccess: true, data: null };
  },
  handler: async (event, ctx) => {
    const { displayName, address } = event.payload;
    const connected = await ctx.dispatch.write(InboundMailFoundationHandlers.connectAccount, {
      provider: IMAP_PROVIDER_KEY,
      authMethod: InboundMailAuthMethods.password,
      displayName,
      address,
      scope: "shared",
    });
    if (!connected.isSuccess) return connected;
    const { accountId } = connectedAccountSchema.parse(connected.data);

    const secrets = requireSecretsContext(
      { secrets: ctx.services.secrets, user: ctx.user },
      "connect-mailbox",
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
    return { isSuccess: true, data: { accountId } };
  },
});
