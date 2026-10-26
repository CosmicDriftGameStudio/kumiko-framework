// Quarantine of poison mails: messages the supervisor cannot ingest (unparseable MIME, payload the
// ingest handler rejects for good, or repeated hard failures). A quarantined id counts as seen, so the
// cursor moves on instead of retrying the same mail forever. Rows carry ids only, no mail content.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne, insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { type QuarantineReasonCode, quarantineTable } from "./entities.ts";

const LOOKUP_CHUNK_SIZE = 1000;
export const QUARANTINE_ACKNOWLEDGED_RETENTION_DAYS = 90;

type QuarantineTarget = {
  readonly tenantId: string;
  readonly accountId: string;
  readonly providerMessageId: string;
};

/** Returns true when a new row was written, false when the message was already quarantined. */
export async function quarantineMessage(
  db: DbConnection,
  target: QuarantineTarget,
  reasonCode: QuarantineReasonCode,
): Promise<boolean> {
  const key = { accountId: target.accountId, providerMessageId: target.providerMessageId };
  if (await fetchOne<{ id: string }>(db, quarantineTable, key)) return false;
  try {
    await insertOne(db, quarantineTable, {
      id: crypto.randomUUID(),
      tenantId: target.tenantId,
      ...key,
      reasonCode,
      quarantinedAt: Temporal.Now.instant().toString(),
    });
    return true;
  } catch (err) {
    // A concurrent worker quarantined the same message between the check and the insert.
    if (await fetchOne<{ id: string }>(db, quarantineTable, key)) return false;
    throw err;
  }
}

export async function quarantinedMessageIds(
  db: DbConnection,
  accountId: string,
  providerMessageIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (let start = 0; start < providerMessageIds.length; start += LOOKUP_CHUNK_SIZE) {
    const rows = await selectMany<{ providerMessageId: string }>(
      db,
      quarantineTable,
      {
        accountId,
        providerMessageId: { in: providerMessageIds.slice(start, start + LOOKUP_CHUNK_SIZE) },
      },
      { fields: ["providerMessageId"] },
    );
    for (const row of rows) ids.add(row.providerMessageId);
  }
  return ids;
}

export async function hasOpenQuarantine(db: DbConnection, accountId: string): Promise<boolean> {
  const rows = await selectMany<{ id: string }>(
    db,
    quarantineTable,
    { accountId, acknowledgedAt: null },
    { fields: ["id"], limit: 1 },
  );
  return rows.length > 0;
}
