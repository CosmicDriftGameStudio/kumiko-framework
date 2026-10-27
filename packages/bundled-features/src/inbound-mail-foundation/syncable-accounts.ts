// Account snapshot for the sync supervisor: accounts of all tenants that should be polled, with the
// address decrypted (providers never work with ciphertext). Degraded accounts stay in the set, so a
// poison mail or a transient outage does not stop the sync that would heal them.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  ENCRYPTION_UNAVAILABLE_CODE,
  type LocalKeyKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type InboundMailAccountStatus, InboundMailAccountStatuses } from "./constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS } from "./entities.ts";
import { mailAccountsProjectionTable } from "./projection.ts";
import type { MailAccountRecord } from "./types.ts";

export type SyncableAccount = MailAccountRecord & {
  /** Health code currently shown on the account; supervisor-internal, not part of the provider contract. */
  readonly lastError: string | null;
};

/** What the account health needs of an account, which an account without a readable address still has. */
export type AccountHealthRef = Pick<SyncableAccount, "id" | "tenantId" | "status" | "lastError">;

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
  readonly trustedAuthservId?: string | null;
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

type KeyStoreOutageListener = {
  readonly onKeyStoreUnavailable: (account: AccountHealthRef) => Promise<void>;
};

// Undefined skips the account: one undecryptable account must not stop polling of every other
// tenant's accounts.
async function decryptedAddressOf(
  row: SyncableMailAccountRow,
  piiKms: LocalKeyKmsAdapter | undefined,
  log: (line: string) => void,
  health: KeyStoreOutageListener | undefined,
): Promise<string | undefined> {
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
    // A key store outage is not the account's problem, but without a mark it would look active.
    if (health && errorCodeOf(error) === ENCRYPTION_UNAVAILABLE_CODE) {
      await health.onKeyStoreUnavailable({
        id: row.id,
        tenantId: row.tenantId,
        status: syncableStatusOf(row.status),
        lastError: row.lastError ?? null,
      });
    }
    return undefined;
  }
  const address = decrypted["address"];
  // Falling back to row.address would hand the ciphertext to a provider.
  if (typeof address === "string") return address;
  log(`inbound-mail: account ${row.id} skipped — address did not decrypt to text`);
  return undefined;
}

export async function listSyncableAccounts(
  db: DbConnection,
  log: (line: string) => void,
  options: { readonly onlyAccountId?: string; readonly health?: KeyStoreOutageListener } = {},
): Promise<readonly SyncableAccount[]> {
  const { onlyAccountId, health } = options;
  const rows = await selectMany<SyncableMailAccountRow>(db, mailAccountsProjectionTable, {
    status: { in: SYNCABLE_STATUSES },
    ...(onlyAccountId !== undefined && { id: onlyAccountId }),
  });
  const piiKms = configuredPiiSubjectKms();
  const records: SyncableAccount[] = [];
  for (const row of rows) {
    const address = await decryptedAddressOf(row, piiKms, log, health);
    if (address === undefined) continue;
    records.push({
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      authMethod: row.authMethod,
      ownerUserId: row.ownerUserId ?? null,
      address,
      displayName: row.displayName ?? "",
      status: syncableStatusOf(row.status),
      watchState: row.watchState ?? "idle",
      lastError: row.lastError ?? null,
      trustedAuthservId: row.trustedAuthservId ?? null,
    });
  }
  return records;
}
