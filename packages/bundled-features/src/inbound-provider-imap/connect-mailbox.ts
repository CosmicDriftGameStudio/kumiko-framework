// connect-mailbox: the form path for a password IMAP mailbox. The IMAP login and then the SMTP
// login of the outgoing server are checked before the transaction opens; only then the account
// stream and its credential secret are written, both on the request transaction, so a failure
// leaves neither behind.

import {
  type AddressMatch,
  findMailboxByAddress,
  InboundAuthError,
  InboundMailAccountStatuses,
  InboundMailAuthMethods,
  InboundMailFoundationHandlers,
  type InboundMailRoles,
  inboundCredentialSecretKey,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  type BeforeTransactionResult,
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { IMAP_CONNECT_ERRORS, IMAP_PROVIDER_KEY, SMTP_CONNECT_ERRORS } from "./constants.ts";
import {
  type ImapCredentialDocument,
  imapCredentialDocumentSchema,
  smtpHostSchema,
} from "./credential-document.ts";
import { connectOnce, IMAP_HOST_UNREACHABLE_MESSAGE } from "./imap-client.ts";
import { type SmtpFailure, SmtpFailureError, verifySmtpLogin } from "./smtp-client.ts";

// No `secure`: the password never crosses the wire in clear text, so a payload's secure:false is
// stripped like any unknown key. IMAP uses implicit TLS; SMTP uses implicit TLS on 465 and
// enforced STARTTLS on every other port.
export const connectMailboxSchema = imapCredentialDocumentSchema
  .pick({ host: true, port: true, user: true })
  .extend({
    displayName: z.string().trim().min(1).max(200),
    address: z.email().max(320),
    password: z.string().min(1).max(1000),
    smtpHost: z.union([z.literal(""), smtpHostSchema]).nullish(),
    smtpPort: z.number().int().min(1).max(65535),
    trustedAuthservId: z.string().trim().max(255).nullish(),
  });
type ConnectMailboxLoginFields = Pick<
  z.infer<typeof connectMailboxSchema>,
  "host" | "port" | "user" | "password" | "smtpHost" | "smtpPort"
>;

function isReopenableByThisForm(existing: AddressMatch, ownerUserId: string | null): boolean {
  return (
    existing.status === InboundMailAccountStatuses.disconnected &&
    existing.provider === IMAP_PROVIDER_KEY &&
    existing.authMethod === InboundMailAuthMethods.password &&
    existing.ownerUserId === ownerUserId
  );
}

const connectedAccountSchema = z.object({ accountId: z.string() });

// Matched on the mapped error text, which also carries the host, so only markers no host name
// contains: a bare "tls" or "ssl" would misread a host like ssl.example.com.
// BoringSSL (Bun) spells the handshake error WRONG_VERSION_NUMBER, OpenSSL (Node) with spaces.
const TLS_FAILURE = /certificate|self[- ]signed|wrong[ _]version[ _]number|EPROTO|ERR_SSL|ERR_TLS/i;

// A fixed preview: any slice of the JSON document would expose the host or the user.
export const CREDENTIAL_PREVIEW = "IMAP login";

type ConnectFailure = keyof typeof IMAP_CONNECT_ERRORS;

// Most hosters name the outgoing server like the incoming one, or with smtp. for imap.
export function deriveSmtpHost(imapHost: string): string {
  return /^imap\./i.test(imapHost) ? `smtp.${imapHost.slice("imap.".length)}` : imapHost;
}

export function credentialDocumentOf(payload: ConnectMailboxLoginFields): ImapCredentialDocument {
  const { host, port, user, password, smtpPort } = payload;
  const smtpHost = payload.smtpHost || deriveSmtpHost(host);
  return { host, port, secure: true, user, password, smtpHost, smtpPort };
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

// Checks the IMAP login, then the SMTP login of the outgoing server; shared by connect and reconnect.
export async function checkMailboxLogin(
  doc: ImapCredentialDocument,
  log: { warn(message: string, data?: Record<string, unknown>): void },
): Promise<BeforeTransactionResult<null>> {
  try {
    await connectOnce(doc, true);
  } catch (err) {
    const { reason, i18nKey } = IMAP_CONNECT_ERRORS[imapConnectFailureOf(err)];
    log.warn("imap connect check failed", { reason });
    return writeFailure(new UnprocessableError(reason, { i18nKey }));
  }
  const smtpFailure = await checkSmtpLogin(doc);
  if (smtpFailure) {
    const { reason, i18nKey } = SMTP_CONNECT_ERRORS[smtpFailure];
    log.warn("smtp connect check failed", { reason });
    return writeFailure(
      new UnprocessableError(reason, { i18nKey, i18nParams: { port: doc.smtpPort } }),
    );
  }
  return { isSuccess: true, data: null };
}

export const SECRET_TRANSACTION_REASON =
  "the credential secret is written on the request transaction so a failed account connect rolls it back too";

type ConnectedMailbox = {
  readonly displayName: string;
  readonly address: string;
  readonly credentialDocument: ImapCredentialDocument;
};

// Shared by the admin form (shared mailbox) and the member form (personal mailbox, owner = caller).
// A disconnected password mailbox of the same scope and owner is brought back under its old account id,
// so cursor, seen anchors and threads survive; anything else keeps connect-account's conflict answer.
export async function connectPasswordMailbox(
  handlerName: string,
  event: { readonly user: { readonly id: string; readonly tenantId: string } },
  ctx: HandlerContext,
  mailbox: ConnectedMailbox,
  scope: "shared" | "user",
): Promise<WriteResult<{ accountId: string }>> {
  const { displayName, address, credentialDocument } = mailbox;
  const ownerUserId = scope === "user" ? event.user.id : null;
  const existing = await findMailboxByAddress(ctx, event.user.tenantId, address);
  const reopened = existing !== undefined && isReopenableByThisForm(existing, ownerUserId);
  let accountId: string;
  if (reopened) {
    accountId = existing.id;
  } else {
    const accountFields = {
      provider: IMAP_PROVIDER_KEY,
      authMethod: InboundMailAuthMethods.password,
      displayName,
      address,
      scope,
    };
    // connect-account is admin-only, so a member's personal mailbox goes through the system identity
    // with the owner taken from this session, like the OAuth callback does.
    const connected =
      scope === "user"
        ? await ctx.dispatch.writeAs(
            createSystemUser(ctx.user.tenantId, [ROLES.SystemAdmin]),
            InboundMailFoundationHandlers.connectAccount,
            { ...accountFields, ownerUserIdOverride: event.user.id },
          )
        : await ctx.dispatch.write(InboundMailFoundationHandlers.connectAccount, accountFields);
    if (!connected.isSuccess) return connected;
    accountId = connectedAccountSchema.parse(connected.data).accountId;
  }

  const secrets = requireSecretsContext(
    { secrets: ctx.services.secrets, user: ctx.user },
    handlerName,
  ).withRunner(ctx.db.unsafeRaw());
  await secrets.set(
    event.user.tenantId,
    inboundCredentialSecretKey(accountId),
    JSON.stringify(credentialDocument),
    {
      redact: () => CREDENTIAL_PREVIEW,
      hint: `IMAP credentials for inbound mail account ${accountId}`,
      updatedBy: event.user.id,
    },
  );
  if (reopened) {
    // Secret first: reactivating a disconnected account requires the credential to exist.
    const reactivated = await ctx.dispatch.write(InboundMailFoundationHandlers.reactivateAccount, {
      accountId,
    });
    if (!reactivated.isSuccess) return reactivated;
  }
  return { isSuccess: true, data: { accountId } };
}

export const createConnectMailboxHandler = ({ adminRoles }: InboundMailRoles) =>
  defineWriteHandler({
    name: "connect-mailbox",
    description:
      "Connects a shared IMAP mailbox with a password over implicit TLS: checks the IMAP login and the SMTP login of the outgoing server (given, or derived from the IMAP host) first, then creates the mail account and stores both servers, user and password as its credential secret in one step.",
    // The payload carries the plaintext password: as a tool call it would reach the model provider.
    agent: { expose: false },
    schema: connectMailboxSchema,
    access: { roles: [...adminRoles] },
    // Each call opens a connection to a host the caller picks; the cap keeps the form from being
    // used to scan ports or to guess passwords at someone else's mail server.
    rateLimit: { per: "tenant+handler", limit: 10, windowSeconds: 600 },
    escapeHatch: { grants: ["unsafeRaw"], reason: SECRET_TRANSACTION_REASON },
    beforeTransaction: (event, ctx) =>
      checkMailboxLogin(credentialDocumentOf(event.payload), ctx.obs.log),
    handler: async (event, ctx) => {
      const { displayName, address, trustedAuthservId } = event.payload;
      const connected = await connectPasswordMailbox(
        "connect-mailbox",
        event,
        ctx,
        { displayName, address, credentialDocument: credentialDocumentOf(event.payload) },
        "shared",
      );
      if (!connected.isSuccess) return connected;
      const { accountId } = connected.data;
      if (trustedAuthservId) {
        const trusted = await ctx.dispatch.write(
          InboundMailFoundationHandlers.setTrustedAuthservId,
          {
            accountId,
            trustedAuthservId,
          },
        );
        if (!trusted.isSuccess) return trusted;
      }
      return { isSuccess: true, data: { accountId } };
    },
  });
