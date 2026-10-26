// Cursor persistence of the sync supervisor (unmanaged direct-write store).

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { syncCursorTable } from "./entities.ts";
import type { MailAccountRecord, SyncCursorPayload } from "./types.ts";

/** One cursor per account (one mailbox inbox) for now; multi-folder support
 *  can add further scopes later without a schema change. */
const CURSOR_SCOPE = "default";

export type SyncCursorStore = {
  readonly load: (accountId: string) => Promise<SyncCursorPayload | null>;
  readonly save: (
    account: Pick<MailAccountRecord, "id" | "tenantId">,
    cursor: SyncCursorPayload,
  ) => Promise<void>;
  /** The next fetch runs as a backfill. */
  readonly reset: (accountId: string) => Promise<void>;
};

export function createSyncCursorStore(db: DbRunner): SyncCursorStore {
  return {
    async load(accountId) {
      const row = await fetchOne<{ cursor: string }>(db, syncCursorTable, {
        accountId,
        scope: CURSOR_SCOPE,
      });
      if (!row) return null;
      try {
        const parsed: unknown = JSON.parse(row.cursor);
        return isPlainObject(parsed) ? parsed : null;
      } catch {
        return null; // a corrupt cursor counts as none → backfill; dedup catches duplicates
      }
    },

    async save(account, cursor) {
      const accountId = account.id;
      const now = Temporal.Now.instant().toString();
      const serialized = JSON.stringify(cursor);
      const existing = await fetchOne<{ id: string }>(db, syncCursorTable, {
        accountId,
        scope: CURSOR_SCOPE,
      });
      if (existing) {
        await updateMany(
          db,
          syncCursorTable,
          { cursor: serialized, updatedAt: now },
          { accountId, scope: CURSOR_SCOPE },
        );
        // skip: the update path is complete; do not fall through to the insert branch.
        return;
      }
      await insertOne(db, syncCursorTable, {
        id: crypto.randomUUID(),
        // Direct-write store: no executor stamps the NOT NULL tenant_id for us.
        tenantId: account.tenantId,
        accountId,
        scope: CURSOR_SCOPE,
        cursor: serialized,
        updatedAt: now,
      });
    },

    async reset(accountId) {
      // An empty cursor parses to null, so the next fetch runs as a backfill.
      await updateMany(
        db,
        syncCursorTable,
        { cursor: "", updatedAt: Temporal.Now.instant().toString() },
        { accountId, scope: CURSOR_SCOPE },
      );
    },
  };
}
