import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import { type InboundMailAccountStatus, InboundMailAccountStatuses } from "./constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS } from "./entities.ts";
import type { MailAccountRecord } from "./types.ts";

export type MailAccountRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly authMethod: string;
  readonly ownerUserId?: string | null;
  readonly address: string;
  readonly displayName?: string | null;
  readonly status?: string | null;
  readonly watchState?: string | null;
};

function isAccountStatus(value: unknown): value is InboundMailAccountStatus {
  return Object.values(InboundMailAccountStatuses).some((status) => status === value);
}

// Providers never see ciphertext, so the address is decrypted before the call.
export async function toMailAccountRecord(
  row: MailAccountRow,
  tenantId: string,
  requestId: string,
): Promise<MailAccountRecord> {
  const piiKms = configuredPiiSubjectKms();
  const decrypted = piiKms
    ? await decryptPiiFieldValues(row, MAIL_ACCOUNT_PII_FIELDS, piiKms, { requestId })
    : row;
  const address = decrypted["address"];
  if (typeof address !== "string") throw new Error("mailbox address did not decrypt to text");
  return {
    id: row.id,
    tenantId,
    provider: row.provider,
    authMethod: row.authMethod,
    ownerUserId: row.ownerUserId ?? null,
    address,
    displayName: row.displayName ?? "",
    status: isAccountStatus(row.status) ? row.status : InboundMailAccountStatuses.active,
    watchState: row.watchState ?? "idle",
  };
}
