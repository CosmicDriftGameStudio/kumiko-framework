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
//   password → { host, port, secure, user, password }
//   xoauth2  → { host, port, secure, user, accessToken } — V1 fallback:
//              OAuth providers (M365/Gmail) handle token acquisition and
//              refresh; the imap provider only consumes a valid access
//              token from the slot.

import * as z from "zod";

export const imapCredentialDocumentSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  user: z.string().min(1).max(320),
  password: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
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
