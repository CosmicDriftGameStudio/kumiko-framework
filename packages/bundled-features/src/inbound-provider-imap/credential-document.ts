// Connection-Dokument im per-Account-Secret-Slot
// (inboundCredentialSecretKey(accountId), Plan §4).
//
// **Warum JSON im Secret statt Tenant-Config-Keys:** anders als
// mail-transport-smtp (EIN SMTP pro Tenant) hat Inbound MEHRERE
// Accounts pro Tenant mit verschiedenen Hosts — per-Tenant-Config-Keys
// können das nicht tragen. Host/Port/User sind zusammen mit dem
// Passwort ein zusammengehöriges Verbindungs-Dokument; der Slot ist
// ohnehin encrypted-at-rest.
//
// authMethod des Accounts bestimmt die Interpretation:
//   password → { host, port, secure, user, password }
//   xoauth2  → { host, port, secure, user, accessToken } — V1-Fallback:
//              Token-Beschaffung/-Refresh gehört den OAuth-Providern
//              (M365/Gmail, Phase 4/5); der imap-Provider konsumiert
//              nur einen gültigen Access-Token aus dem Slot.

import { z } from "zod";

export const imapCredentialDocumentSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  user: z.string().min(1).max(320),
  password: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
});
export type ImapCredentialDocument = z.infer<typeof imapCredentialDocumentSchema>;

export type ParseCredentialResult =
  | { readonly ok: true; readonly doc: ImapCredentialDocument }
  | { readonly ok: false; readonly reason: string };

export function parseImapCredentialDocument(raw: string): ParseCredentialResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "credential document is not valid JSON" };
  }
  const parsed = imapCredentialDocumentSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `credential document invalid: ${parsed.error.message}` };
  }
  if (!parsed.data.password && !parsed.data.accessToken) {
    return { ok: false, reason: "credential document needs password (or accessToken for xoauth2)" };
  }
  return { ok: true, doc: parsed.data };
}
