// Test-/Seed-Helper für managed-pages. Legt eine Page direkt über den
// Event-Store-Executor an — gleicher Pfad wie der echte set-Handler, aber
// ohne Access-Check. Default ifExists="skip".

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { type PageRow, pageEntity, pagesTable } from "./table";

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
  // Default-user muss user.tenantId === opts.tenantId haben (sonst landet
  // der event-store-stream im falschen tenant-bucket → version_conflict
  // bei späteren echten writes). TestUsers.systemAdmin ist testTenantId(1).
  const by = opts.by ?? { ...TestUsers.systemAdmin, tenantId: opts.tenantId };
  const tdb = createTenantDb(db, opts.tenantId, "system");

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
      // @cast-boundary db-row: executor.create result.data ist die inserted
      // Drizzle-Row (Record<string, unknown>), projected nach RETURNING.
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
