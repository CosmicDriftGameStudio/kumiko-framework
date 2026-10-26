// Account snapshot for the sync supervisor: accounts of all tenants that should be polled, with the
// address decrypted (providers never work with ciphertext). Degraded accounts stay in the set, so a
// poison mail or a transient outage does not stop the sync that would heal them.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { type InboundMailAccountStatus, InboundMailAccountStatuses } from "./constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS } from "./entities.ts";
import { mailAccountsProjectionTable } from "./projection.ts";
import type { MailAccountRecord } from "./types.ts";

export type SyncableAccount = MailAccountRecord & {
  /** Health code currently shown on the account; supervisor-internal, not part of the provider contract. */
  readonly lastError: string | null;
};

type SyncableMailAccountRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly authMethod: string;
  readonly ownerUserId?: string | null;
  readonly address: string;
  readonly displayName?: string;
  readonly status?: string;
  readonly watchState?: string;
  readonly lastError?: string | null;
};

const SYNCABLE_STATUSES: readonly InboundMailAccountStatus[] = [
  InboundMailAccountStatuses.active,
  InboundMailAccountStatuses.degraded,
];

function syncableStatusOf(status: string | undefined): InboundMailAccountStatus {
  return status === InboundMailAccountStatuses.degraded
    ? InboundMailAccountStatuses.degraded
    : InboundMailAccountStatuses.active;
}

export async function listSyncableAccounts(
  db: DbConnection,
  log: (line: string) => void,
  onlyAccountId?: string,
): Promise<readonly SyncableAccount[]> {
  const rows = await selectMany<SyncableMailAccountRow>(db, mailAccountsProjectionTable, {
    status: { in: SYNCABLE_STATUSES },
    ...(onlyAccountId !== undefined && { id: onlyAccountId }),
  });
  const piiKms = configuredPiiSubjectKms();
  const records: SyncableAccount[] = [];
  for (const row of rows) {
    let decrypted: Record<string, unknown>;
    try {
      decrypted = piiKms
        ? await decryptPiiFieldValues(row, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
            requestId: "inbound-mail-foundation:supervisor:list-accounts",
          })
        : row;
    } catch (error) {
      // Class name only: the message may carry ciphertext or key details.
      const errorName = error instanceof Error ? error.name : "unknown error";
      log(`inbound-mail: account ${row.id} skipped — address did not decrypt (${errorName})`);
      continue;
    }
    const decryptedAddress = decrypted["address"];
    // Falling back to row.address would hand the ciphertext to a provider.
    // One undecryptable account must not stop polling of every other tenant's accounts.
    if (typeof decryptedAddress !== "string") {
      log(`inbound-mail: account ${row.id} skipped — address did not decrypt to text`);
      continue;
    }
    records.push({
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      authMethod: row.authMethod,
      ownerUserId: row.ownerUserId ?? null,
      address: decryptedAddress,
      displayName: row.displayName ?? "",
      status: syncableStatusOf(row.status),
      watchState: row.watchState ?? "idle",
      lastError: row.lastError ?? null,
    });
  }
  return records;
}
