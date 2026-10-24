// Test/seed helper for managed-pages. Creates a page directly through the
// event-store executor—the same path as the real set handler, but without an
// access check. Default ifExists="skip".

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  runEventStoreSeed,
  type SeedIfExists,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/seeding";

import { type PageRow, pageEntity, pagesTable } from "./table.ts";

const executor = createEventStoreExecutor(pagesTable, pageEntity, { entityName: "page" });

export type SeedPageOptions = {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body?: string | null;
  readonly description?: string | null;
  readonly ogImage?: string | null;
  readonly published?: boolean;
  readonly by?: SessionUser;
  readonly ifExists?: SeedIfExists;
};

export async function seedPage(db: DbConnection, opts: SeedPageOptions): Promise<{ id: string }> {
  // The default user must have user.tenantId === opts.tenantId; otherwise the
  // event-store stream ends up in the wrong tenant bucket → version_conflict
  // on subsequent real writes. TestUsers.systemAdmin is testTenantId(1).
  const by = opts.by ?? { ...TestUsers.systemAdmin, tenantId: opts.tenantId };
  const tdb = createTenantDb({
    db,
    tenantId: opts.tenantId,
    mode: "system",
    reason: "seeding writes managed pages into an explicitly named tenant",
  });

  const existing = await fetchOne<PageRow>(db, pagesTable, {
    tenantId: opts.tenantId,
    slug: opts.slug,
    lang: opts.lang,
  });

  const description = opts.description ?? null;
  const ogImage = opts.ogImage ?? null;
  const published = opts.published ?? false;

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
          description,
          ogImage,
          published,
          tenantId: opts.tenantId,
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedPage create failed: ${JSON.stringify(result)}`);
      }
      // @cast-boundary db-row: executor.create result.data is the inserted
      // Drizzle row (Record<string, unknown>), projected from RETURNING.
      const data = result.data as Partial<PageRow>;
      if (data.id === undefined) {
        throw new Error("seedPage: executor.create did not return an id");
      }
      return { id: data.id };
    },
    update: async (row) => {
      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: {
            title: opts.title,
            body: opts.body ?? null,
            description,
            ogImage,
            published,
          },
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedPage update failed: ${JSON.stringify(result)}`);
      }
      return { id: row.id };
    },
  });
}
