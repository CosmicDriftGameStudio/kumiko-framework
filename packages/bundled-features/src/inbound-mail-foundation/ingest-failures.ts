// Failure counter of mails the ingest could not take. Persisted, so every worker replica and every
// restart sees the same count; a poison mail therefore reaches quarantine instead of blocking the
// cursor of its mailbox forever. Rows carry ids only, no mail content.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  deleteMany,
  deriveEntityTableMeta,
  fetchOne,
  insertOnConflictDoNothing,
  updateMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export const MAX_COUNTED_INGEST_FAILURES = 3;
const COMPARE_AND_SET_ATTEMPTS = 3;

const technicalReference = {
  access: { write: access.privileged },
  personal: false,
  reason: "technical_reference",
} as const;

export const ingestFailureEntity = createEntity({
  table: "store_mail_ingest_failures",
  softDelete: false,
  indexes: [{ unique: true, columns: ["tenantId", "accountId", "providerMessageId"] }],
  fields: {
    accountId: createTextField({ required: true, maxLength: 36, ...technicalReference }),
    providerMessageId: createTextField({ required: true, maxLength: 500, ...technicalReference }),
    failureCount: createNumberField({ required: true, integer: true, default: 0 }),
    // Double precision: epoch milliseconds divided by a short poll interval overflow a 32-bit integer.
    lastCountedBucket: createNumberField({ required: true, default: 0 }),
    lastFailedAt: createTimestampField({ required: true, access: { write: access.privileged } }),
  },
});

export const ingestFailureTable = deriveEntityTableMeta(
  "mail-ingest-failure",
  ingestFailureEntity,
  { source: "unmanaged" },
);

export type IngestFailureTarget = {
  readonly tenantId: string;
  readonly accountId: string;
  readonly providerMessageId: string;
};

type CounterRow = { readonly failureCount: number };

/** Bucket of one poll interval: replicas and overlapping polls inside the same interval count a mail once. */
export function countBucketOf(now: Temporal.Instant, pollIntervalMs: number): number {
  return Math.floor(now.epochMilliseconds / pollIntervalMs);
}

export function currentCountBucket(
  now: (() => Temporal.Instant) | undefined,
  pollIntervalMs: number,
): number {
  return countBucketOf((now ?? Temporal.Now.instant)(), pollIntervalMs);
}

/** The new failure count, or null when this bucket was already counted (or another worker won the race). */
export async function countIngestFailure(
  db: DbConnection,
  target: IngestFailureTarget,
  bucket: number,
): Promise<number | null> {
  const key = { accountId: target.accountId, providerMessageId: target.providerMessageId };
  const lastFailedAt = Temporal.Now.instant().toString();
  const inserted = await insertOnConflictDoNothing(
    db,
    ingestFailureTable,
    {
      id: crypto.randomUUID(),
      tenantId: target.tenantId,
      ...key,
      failureCount: 1,
      lastCountedBucket: bucket,
      lastFailedAt,
    },
    { conflictKeys: ["tenantId", "accountId", "providerMessageId"] },
  );
  if (inserted) return 1;
  for (let attempt = 0; attempt < COMPARE_AND_SET_ATTEMPTS; attempt++) {
    const row = await fetchOne<CounterRow>(db, ingestFailureTable, key);
    if (!row) return null;
    const next = row.failureCount + 1;
    const updated = await updateMany(
      db,
      ingestFailureTable,
      { failureCount: next, lastCountedBucket: bucket, lastFailedAt },
      { ...key, failureCount: row.failureCount, lastCountedBucket: { lt: bucket } },
    );
    if (updated.length > 0) return next;
    const current = await fetchOne<CounterRow & { readonly lastCountedBucket: number }>(
      db,
      ingestFailureTable,
      key,
    );
    // skip: this bucket is counted already, a second count would double the failure of one interval
    if (!current || current.lastCountedBucket >= bucket) return null;
  }
  return null;
}

export async function hasCountedIngestFailure(
  db: DbConnection,
  target: IngestFailureTarget,
): Promise<boolean> {
  const row = await fetchOne<CounterRow>(db, ingestFailureTable, {
    accountId: target.accountId,
    providerMessageId: target.providerMessageId,
  });
  return row !== undefined;
}

export async function clearIngestFailures(
  db: DbConnection,
  accountId: string,
  providerMessageIds: readonly string[],
): Promise<void> {
  // skip: nothing to clear
  if (providerMessageIds.length === 0) return;
  await deleteMany(db, ingestFailureTable, {
    accountId,
    providerMessageId: { in: [...providerMessageIds] },
  });
}
