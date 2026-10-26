// Connection document stored in the per-account secret slot
// (inboundCredentialSecretKey(accountId)).
//
// **Why JSON in the secret instead of tenant config keys:** unlike
// mail-transport-smtp (one SMTP configuration per tenant), inbound mail
// supports multiple accounts per tenant with different hosts, which
// per-tenant config keys cannot represent. Host, port, and user belong
// with the password in one connection document; the slot is encrypted
// at rest.
//
// The account's authMethod determines the interpretation:
//   password → { host, port, secure, user, password, smtpHost?, smtpPort }
//   xoauth2  → { host, port, secure, user, accessToken } — V1 fallback:
//              OAuth providers (M365/Gmail) handle token acquisition and
//              refresh; the imap provider only consumes a valid access
//              token from the slot.
//
// smtpHost is the outgoing server for sending from the mailbox, with the same user and password
// over implicit TLS. Documents written before sending existed have none: sending reports
// "not set up" instead of guessing a host.

import {
  InboundAuthError,
  InboundCredentialNotStoredError,
  type InboundMailContext,
  inboundCredentialSecretKey,
  type MailAccountRecord,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import * as z from "zod";
import { FEATURE_NAME, SMTP_SUBMISSION_PORT } from "./constants.ts";

// A bare host name: a port, path or whitespace would point the connect somewhere the guard did
// not check.
export const smtpHostSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s:/@]+$/);

export const imapCredentialDocumentSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  user: z.string().min(1).max(320),
  password: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  smtpHost: smtpHostSchema.optional(),
  smtpPort: z.number().int().min(1).max(65535).default(SMTP_SUBMISSION_PORT),
});
export type ImapCredentialDocument = z.infer<typeof imapCredentialDocumentSchema>;

export type ImapCredentialRejection = "not_json" | "invalid_schema" | "missing_credentials";

export type ParseCredentialResult =
  | { readonly ok: true; readonly doc: ImapCredentialDocument }
  | { readonly ok: false; readonly reason: ImapCredentialRejection; readonly detail?: string };

export function parseImapCredentialDocument(raw: string): ParseCredentialResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = imapCredentialDocumentSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_schema", detail: parsed.error.message };
  }
  if (!parsed.data.password && !parsed.data.accessToken) {
    return { ok: false, reason: "missing_credentials", detail: "needs password or accessToken" };
  }
  return { ok: true, doc: parsed.data };
}

export async function readCredentialDocument(
  ctx: InboundMailContext,
  account: MailAccountRecord,
): Promise<ImapCredentialDocument> {
  const secrets = requireSecretsContext(
    { secrets: ctx.secrets, auditUserId: ctx.auditUserId },
    FEATURE_NAME,
  );
  const secret = await secrets.get(account.tenantId, inboundCredentialSecretKey(account.id));
  if (!secret) {
    throw new InboundCredentialNotStoredError(
      `${FEATURE_NAME}: no credential document in secret slot for account ${account.id} — ` +
        `store the IMAP connection JSON under ${inboundCredentialSecretKey(account.id)} first`,
    );
  }
  const parsed = parseImapCredentialDocument(secret.reveal());
  if (!parsed.ok) {
    throw new InboundAuthError(
      `${FEATURE_NAME}: account ${account.id}: ${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
    );
  }
  return parsed.doc;
}
