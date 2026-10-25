// connect-mailbox: the form path for a password IMAP mailbox. The IMAP login and then the SMTP
// login of the outgoing server are checked before the transaction opens; only then the account
// stream and its credential secret are written, both on the request transaction, so a failure
// leaves neither behind.

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
import { IMAP_CONNECT_ERRORS, IMAP_PROVIDER_KEY, SMTP_CONNECT_ERRORS } from "./constants.ts";
import {
  type ImapCredentialDocument,
  imapCredentialDocumentSchema,
  SMTP_IMPLICIT_TLS_PORT,
  smtpHostSchema,
} from "./credential-document.ts";
import { connectOnce, IMAP_HOST_UNREACHABLE_MESSAGE } from "./imap-client.ts";
import { type SmtpFailure, SmtpFailureError, verifySmtpLogin } from "./smtp-client.ts";

// No `secure` and no SMTP port input: the password never crosses the wire in clear text, so a
// payload's secure:false or smtpPort is stripped like any unknown key and both logins always use
// implicit TLS (SMTP on port 465).
const connectMailboxSchema = imapCredentialDocumentSchema
  .pick({ host: true, port: true, user: true })
  .extend({
    displayName: z.string().min(1).max(200),
    address: z.email().max(320),
    password: z.string().min(1).max(1000),
    smtpHost: z.union([z.literal(""), smtpHostSchema]).nullish(),
  });
type ConnectMailboxPayload = z.infer<typeof connectMailboxSchema>;

const connectedAccountSchema = z.object({ accountId: z.string() });

// Matched on the mapped error text, which also carries the host, so only markers no host name
// contains: a bare "tls" or "ssl" would misread a host like ssl.example.com.
// BoringSSL (Bun) spells the handshake error WRONG_VERSION_NUMBER, OpenSSL (Node) with spaces.
const TLS_FAILURE = /certificate|self[- ]signed|wrong[ _]version[ _]number|EPROTO|ERR_SSL|ERR_TLS/i;

// A fixed preview: any slice of the JSON document would expose the host or the user.
const CREDENTIAL_PREVIEW = "IMAP login";

const SECRET_TRANSACTION_REASON =
  "the credential secret is written on the request transaction so a failed account connect rolls it back too";

type ConnectFailure = keyof typeof IMAP_CONNECT_ERRORS;

// Most hosters name the outgoing server like the incoming one, or with smtp. for imap.
export function deriveSmtpHost(imapHost: string): string {
  return /^imap\./i.test(imapHost) ? `smtp.${imapHost.slice("imap.".length)}` : imapHost;
}

function credentialDocumentOf(payload: ConnectMailboxPayload): ImapCredentialDocument {
  const { host, port, user, password } = payload;
  const smtpHost = payload.smtpHost || deriveSmtpHost(host);
  return { host, port, secure: true, user, password, smtpHost, smtpPort: SMTP_IMPLICIT_TLS_PORT };
}

// The raw error carries the host and the server response; the tenant only gets the category.
// A blocked host and an unresolvable one share one text on purpose (see createImapClient).
function imapConnectFailureOf(err: unknown): ConnectFailure {
  const message = err instanceof Error ? err.message : "";
  if (message === IMAP_HOST_UNREACHABLE_MESSAGE) return "hostUnreachable";
  if (err instanceof InboundAuthError) return "loginRejected";
  if (TLS_FAILURE.test(message)) return "tlsFailed";
  return "connectFailed";
}

// verify never sends a mail, so a refused message cannot happen here; anything else answering
// with an SMTP reply is a server we could not use.
function smtpConnectFailureOf(failure: SmtpFailure): ConnectFailure {
  return failure === "rejected" ? "connectFailed" : failure;
}

async function checkSmtpLogin(doc: ImapCredentialDocument): Promise<ConnectFailure | undefined> {
  const { smtpHost, smtpPort, user, password } = doc;
  // A derived host from an odd IMAP host name could not be stored as a valid document.
  if (!smtpHost || !password || !smtpHostSchema.safeParse(smtpHost).success) {
    return "hostUnreachable";
  }
  try {
    await verifySmtpLogin({ host: smtpHost, port: smtpPort, user, password });
    return undefined;
  } catch (err) {
    if (err instanceof SmtpFailureError) return smtpConnectFailureOf(err.failure);
    throw err;
  }
}

export const connectMailboxHandler = defineWriteHandler({
  name: "connect-mailbox",
  description:
    "Connects a shared IMAP mailbox with a password over implicit TLS: checks the IMAP login and the SMTP login of the outgoing server (given, or derived from the IMAP host) first, then creates the mail account and stores both servers, user and password as its credential secret in one step.",
  // The payload carries the plaintext password: as a tool call it would reach the model provider.
  agent: { expose: false },
  schema: connectMailboxSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  // Each call opens a connection to a host the caller picks; the cap keeps the form from being
  // used to scan ports or to guess passwords at someone else's mail server.
  rateLimit: { per: "tenant+handler", limit: 10, windowSeconds: 600 },
  escapeHatch: { grants: ["unsafeRaw"], reason: SECRET_TRANSACTION_REASON },
  beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<null>> => {
    const doc = credentialDocumentOf(event.payload);
    try {
      await connectOnce(doc, true);
    } catch (err) {
      const { reason, i18nKey } = IMAP_CONNECT_ERRORS[imapConnectFailureOf(err)];
      ctx.obs.log.warn("imap connect check failed", { reason });
      return writeFailure(new UnprocessableError(reason, { i18nKey }));
    }
    const smtpFailure = await checkSmtpLogin(doc);
    if (smtpFailure) {
      const { reason, i18nKey } = SMTP_CONNECT_ERRORS[smtpFailure];
      ctx.obs.log.warn("smtp connect check failed", { reason });
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
