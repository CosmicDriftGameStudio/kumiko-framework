// Test-Helper für text-content. Legt einen TextBlock direkt über den
// Event-Store-Executor an — gleicher Pfad wie der echte set-Handler,
// aber ohne Access-Check. Default ifExists="skip": nur fehlende Blocks
// anlegen; opt-in update für Demo-Fixtures.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { type TextBlockRow, textBlockEntity, textBlocksTable } from "./table";

const executor = createEventStoreExecutor(textBlocksTable, textBlockEntity, {
  entityName: "text-block",
});

export type SeedTextBlockOptions = {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body?: string | null;
  /** V.1.4: Folder-Pfad für Visual-Tree-Gruppierung. Optional + null =
   *  root-node. Seed-Pfad bypasst slugSchema/folderSchema-Validation
   *  (system-trusted), aber App-Builder sollten kebab-only nutzen damit
   *  set.write die geseedete Row später überschreiben kann. */
  readonly folder?: string | null;
  readonly by?: SessionUser;
  readonly ifExists?: SeedIfExists;
};

export async function seedTextBlock(
  db: DbConnection,
  opts: SeedTextBlockOptions,
): Promise<{ id: string | number }> {
  // Default-user muss user.tenantId === opts.tenantId haben, sonst
  // landet der event-store-stream im user.tenantId-bucket aber die
  // projection-row im opts.tenantId-bucket. Spätere echte writes via
  // set-handler (mit korrektem tenant-context) finden den stream
  // nicht → version_conflict. TestUsers.systemAdmin ist hardcoded
  // testTenantId(1), nicht opts.tenantId — explizit überschreiben.
  const by = opts.by ?? { ...TestUsers.systemAdmin, tenantId: opts.tenantId };
  // executor.create erwartet TenantDb — wrapping nötig damit die runtime-
  // checks (tenant-scope-validation) greifen.
  const tdb = createTenantDb(db, opts.tenantId, "system");

  const existing = await fetchOne<TextBlockRow>(db, textBlocksTable, {
    tenantId: opts.tenantId,
    slug: opts.slug,
    lang: opts.lang,
  });

  const folder = opts.folder ?? null;

  return runEventStoreSeed({
    existing,
    ifExists: opts.ifExists,
    create: async () => {
      const result = await executor.create(
        {
          slug: opts.slug,
          lang: opts.lang,
          title: opts.title,
          body: opts.body ?? null,
          folder,
          tenantId: opts.tenantId,
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedTextBlock create failed: ${JSON.stringify(result)}`);
      }
      const data = result.data as Partial<TextBlockRow>;
      if (data.id === undefined) {
        throw new Error("seedTextBlock: executor.create did not return an id");
      }
      return { id: data.id };
    },
    update: async (row) => {
      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: { title: opts.title, body: opts.body ?? null, folder },
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedTextBlock update failed: ${JSON.stringify(result)}`);
      }
      return { id: row.id };
    },
  });
}
