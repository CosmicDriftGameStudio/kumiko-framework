// Boot-/test-seed helpers for text-content. Creates a TextBlock via the
// event-store executor — same path as the real set-handler, without the
// access check. Default ifExists="skip": only missing blocks; opt-in
// update for demo fixtures / legal template authority.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";
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
  /** V.1.4: Folder path for visual-tree grouping. Optional + null =
   *  root node. Seed path bypasses slugSchema/folderSchema validation
   *  (system-trusted), but app builders should keep kebab-only so
   *  set.write can overwrite the seeded row later. */
  readonly folder?: string | null;
  readonly by?: SessionUser;
  readonly ifExists?: SeedIfExists;
};

export async function seedTextBlock(
  db: DbConnection,
  opts: SeedTextBlockOptions,
): Promise<{ id: string }> {
  // Default actor is createSystemUser(tenantId) — same as config-seed —
  // so prod boot seeds (legal pages) do not pull TestUsers / stack into
  // the app bundle or stamp phantom test fixture IDs into the audit trail.
  const by = opts.by ?? createSystemUser(opts.tenantId);
  // executor.create expects TenantDb — wrap so runtime tenant-scope checks apply.
  const tdb = createTenantDb(db, opts.tenantId, "system");

  const existing = await fetchOne<TextBlockRow>(db, textBlocksTable, {
    tenantId: opts.tenantId,
    slug: opts.slug,
    lang: opts.lang,
  });

  const folder = opts.folder ?? null;
  const body = opts.body ?? null;

  return runEventStoreSeed({
    existing,
    ifExists: opts.ifExists,
    create: async () => {
      const result = await executor.create(
        {
          slug: opts.slug,
          lang: opts.lang,
          title: opts.title,
          body,
          folder,
          tenantId: opts.tenantId,
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedTextBlock create failed: ${JSON.stringify(result)}`);
      }
      // @cast-boundary db-row: executor.create result.data is the
      // inserted Drizzle row (Record<string, unknown>), projected
      // after INSERT/RETURNING onto TextBlockRow. Runtime check below.
      const data = result.data as Partial<TextBlockRow>;
      if (data.id === undefined) {
        throw new Error("seedTextBlock: executor.create did not return an id");
      }
      return { id: data.id };
    },
    update: async (row) => {
      // Skip no-op updates so legal re-seed on every pod boot does not
      // bump version/updatedAt (ETag / "last changed" / event-store growth).
      if (row.title === opts.title && row.body === body && row.folder === folder) {
        return { id: row.id };
      }
      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: { title: opts.title, body, folder },
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

export type LegalContentBlock = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string;
};

// Boot-seed for legal/marketing copy from a JSON template. `ifExists:
// "update"` is load-bearing: the template is authoritative — otherwise
// legally required additions never reach already-seeded prod rows.
export async function seedLegalContentFromJson(
  db: DbConnection,
  blocks: readonly LegalContentBlock[],
  opts: { readonly tenantId?: TenantId; readonly by?: SessionUser } = {},
): Promise<void> {
  const tenantId = opts.tenantId ?? SYSTEM_TENANT_ID;
  const by = opts.by ?? createSystemUser(tenantId);
  for (const block of blocks) {
    await seedTextBlock(db, {
      tenantId,
      slug: block.slug,
      lang: block.lang,
      title: block.title,
      body: block.body,
      ifExists: "update",
      by,
    });
  }
}
