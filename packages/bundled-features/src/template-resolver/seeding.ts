// Boot-/Seed-Helper für App-Authors. Schreibt System-Templates (tenantId=
// SYSTEM_TENANT_ID, scope=system, status=active) idempotent in die DB —
// gleicher Projection-Pfad wie upsertSystem-Handler, ohne Access-Check.
//
// **Wann nutzen?** runProdApp-seeds / TenantCreated-Hooks die Welcome-,
// Incident- oder Feature-Mail-Slugs installieren, damit renderer-simple
// (oder mail-html) sie per template-resolver auflösen kann.
//
// Default ifExists="skip". `createSystemUser(SYSTEM_TENANT_ID)` als Actor —
// bewusst nicht TestUsers (Prod-Seeds ≠ Test-Utilities).

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createTenantDb,
  type DbConnection,
  deleteMany,
  type EntityTableMeta,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  getStreamVersion,
  getUnscopedStreamMaxVersionForSeed,
} from "@cosmicdrift/kumiko-framework/event-store";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";
import { type ContentFormat, TEXT_BLOCK_KIND, type UpsertKind } from "./constants";
import { executor } from "./handlers/shared";
import { type TemplateResourceRow, templateResourcesTable } from "./table";

/** Drop projection orphans (no events anywhere) so boot seeds can recreate. */
async function resolveExistingForEventStoreSeed(
  db: DbConnection,
  tdb: TenantDb,
  existingRow: { readonly id: string | number; readonly version: number } | null,
  tenantId: TenantId,
): Promise<{ id: string; version: number } | null> {
  if (existingRow == null) return null;
  const id = String(existingRow.id);
  const streamVersion = await getStreamVersion(db, id, tenantId);
  if (streamVersion === 0) {
    // Tenant-scoped 0 can still hide a live stream under another tenant —
    // only delete when unscoped is also empty (true orphan).
    const unscoped = await getUnscopedStreamMaxVersionForSeed(db, id);
    if (unscoped !== 0) {
      throw new Error(
        `seed orphan check: projection ${id} has no events for tenant ${tenantId} but unscoped stream version is ${unscoped} — refusing delete/recreate to avoid wiping a live stream`,
      );
    }
    // @cast-boundary orphan projection cleanup: empty stream, no executor verb;
    // plain table ident trips guard-direct-entity-writes (infra EXCLUDE follow-up).
    await deleteMany(tdb, templateResourcesTable as EntityTableMeta, { id, tenantId });
    return null;
  }
  return { id, version: streamVersion };
}

export type SeedSystemTemplateOptions = {
  readonly slug: string;
  readonly kind: UpsertKind;
  readonly locale: string;
  readonly content: string;
  readonly contentFormat: ContentFormat;
  readonly variableSchema?: Record<string, unknown>;
  readonly linkedResources?: Record<string, string>;
  readonly parentTemplateId?: string | null;
  readonly by?: SessionUser;
  readonly ifExists?: SeedIfExists;
};

export async function seedSystemTemplate(
  db: DbConnection,
  opts: SeedSystemTemplateOptions,
): Promise<{ id: string }> {
  const tenantId = SYSTEM_TENANT_ID as TenantId;
  const by = opts.by ?? createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, "system");

  const existingRow = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    slug: opts.slug,
    kind: opts.kind,
    locale: opts.locale,
  });
  const existing = await resolveExistingForEventStoreSeed(
    db,
    tdb,
    existingRow ? { id: existingRow.id, version: existingRow.version } : null,
    tenantId,
  );

  const variableSchema = JSON.stringify(opts.variableSchema ?? {});
  const linkedResources = JSON.stringify(opts.linkedResources ?? {});
  const parentTemplateId = opts.parentTemplateId ?? null;

  const rowFields = {
    slug: opts.slug,
    kind: opts.kind,
    locale: opts.locale,
    content: opts.content,
    contentFormat: opts.contentFormat,
    variableSchema,
    linkedResources,
    title: null,
    folder: null,
    scope: "system" as const,
    parentTemplateId,
    status: "active" as const,
  };

  return runEventStoreSeed({
    existing,
    ifExists: opts.ifExists,
    create: async () => {
      const result = await executor.create({ ...rowFields, tenantId }, by, tdb);
      if (!result.isSuccess) {
        // Parallel boot pods can both delete the orphan and race on create —
        // unique on (tenantId, slug, kind, locale) → resolve winner and update.
        if (result.error?.code === "unique_violation") {
          const again = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
            tenantId,
            slug: opts.slug,
            kind: opts.kind,
            locale: opts.locale,
          });
          const resolved = await resolveExistingForEventStoreSeed(
            db,
            tdb,
            again ? { id: again.id, version: again.version } : null,
            tenantId,
          );
          if (resolved == null) {
            throw new Error(`seedSystemTemplate create unique_violation but row missing`);
          }
          const upd = await executor.update(
            { id: resolved.id, version: resolved.version, changes: rowFields },
            by,
            tdb,
          );
          if (!upd.isSuccess) {
            throw new Error(`seedSystemTemplate race-update failed: ${JSON.stringify(upd)}`);
          }
          return { id: resolved.id };
        }
        throw new Error(`seedSystemTemplate create failed: ${JSON.stringify(result)}`);
      }
      const data = result.data as Partial<TemplateResourceRow>;
      if (data.id === undefined) {
        throw new Error("seedSystemTemplate: executor.create did not return an id");
      }
      return { id: String(data.id) };
    },
    update: async (row) => {
      const result = await executor.update(
        { id: row.id, version: row.version, changes: rowFields },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedSystemTemplate update failed: ${JSON.stringify(result)}`);
      }
      return { id: String(row.id) };
    },
  });
}

export type SeedTextBlockOptions = {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly content?: string | null;
  /** Folder path for the content tree; optional + null = root node. The seed
   *  path skips slug/folder validation (system-trusted), but app builders
   *  should stay kebab-only so set.write can overwrite the row later. */
  readonly folder?: string | null;
  readonly contentFormat?: ContentFormat;
  readonly by?: SessionUser;
  readonly ifExists?: SeedIfExists;
};

// Boot/test seed for kind=text-block. Same projection path as set.write,
// without the access check. Default ifExists="skip".
export async function seedTextBlock(
  db: DbConnection,
  opts: SeedTextBlockOptions,
): Promise<{ id: string }> {
  const by = opts.by ?? createSystemUser(opts.tenantId);
  const tdb = createTenantDb(db, opts.tenantId, "system");

  const existingRow = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId: opts.tenantId,
    slug: opts.slug,
    kind: TEXT_BLOCK_KIND,
    locale: opts.locale,
  });
  const existing = await resolveExistingForEventStoreSeed(
    db,
    tdb,
    existingRow ? { id: existingRow.id, version: existingRow.version } : null,
    opts.tenantId,
  );

  const fields = {
    slug: opts.slug,
    kind: TEXT_BLOCK_KIND,
    locale: opts.locale,
    title: opts.title,
    content: opts.content ?? null,
    contentFormat: opts.contentFormat ?? ("markdown" as const),
    folder: opts.folder ?? null,
    variableSchema: "{}",
    linkedResources: "{}",
    scope: opts.tenantId === SYSTEM_TENANT_ID ? ("system" as const) : ("tenant" as const),
    parentTemplateId: null,
    status: "active" as const,
  };

  return runEventStoreSeed({
    existing,
    ifExists: opts.ifExists,
    create: async () => {
      const result = await executor.create({ ...fields, tenantId: opts.tenantId }, by, tdb);
      if (!result.isSuccess) {
        if (result.error?.code === "unique_violation") {
          const again = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
            tenantId: opts.tenantId,
            slug: opts.slug,
            kind: TEXT_BLOCK_KIND,
            locale: opts.locale,
          });
          const resolved = await resolveExistingForEventStoreSeed(
            db,
            tdb,
            again ? { id: again.id, version: again.version } : null,
            opts.tenantId,
          );
          if (resolved == null) {
            throw new Error("seedTextBlock create unique_violation but row missing");
          }
          const upd = await executor.update(
            {
              id: resolved.id,
              version: resolved.version,
              changes: { title: fields.title, content: fields.content, folder: fields.folder },
            },
            by,
            tdb,
          );
          if (!upd.isSuccess) {
            throw new Error(`seedTextBlock race-update failed: ${JSON.stringify(upd)}`);
          }
          return { id: resolved.id };
        }
        throw new Error(`seedTextBlock create failed: ${JSON.stringify(result)}`);
      }
      // @cast-boundary db-row — executor.create returns the inserted row from
      // INSERT/RETURNING; id is guaranteed by the PK in the returning clause.
      const data = result.data as Partial<TemplateResourceRow>;
      if (data.id === undefined) {
        throw new Error("seedTextBlock: executor.create did not return an id");
      }
      return { id: String(data.id) };
    },
    update: async (row) => {
      // Skip no-op updates so a legal re-seed on every pod boot does not bump
      // version/updatedAt (ETag, "last changed", event-store growth).
      if (
        existingRow?.title === fields.title &&
        existingRow?.content === fields.content &&
        existingRow?.folder === fields.folder
      ) {
        return { id: String(row.id) };
      }
      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: { title: fields.title, content: fields.content, folder: fields.folder },
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedTextBlock update failed: ${JSON.stringify(result)}`);
      }
      return { id: String(row.id) };
    },
  });
}

export type LegalContentBlock = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly content: string;
};

// Boot seed for legal/marketing copy from a JSON template. `ifExists: "update"`
// is load-bearing: the template is authoritative — otherwise legally required
// additions never reach rows that were seeded once.
export async function seedLegalContentFromJson(
  db: DbConnection,
  blocks: readonly LegalContentBlock[],
  opts: { readonly tenantId?: TenantId; readonly by?: SessionUser } = {},
): Promise<void> {
  const tenantId = opts.tenantId ?? (SYSTEM_TENANT_ID as TenantId);
  const by = opts.by ?? createSystemUser(tenantId);
  for (const block of blocks) {
    await seedTextBlock(db, {
      tenantId,
      slug: block.slug,
      locale: block.locale,
      title: block.title,
      content: block.content,
      ifExists: "update",
      by,
    });
  }
}
