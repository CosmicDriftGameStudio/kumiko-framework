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
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";
import type { ContentFormat, RenderKind } from "./constants";
import { executor } from "./handlers/shared";
import { type TemplateResourceRow, templateResourcesTable } from "./table";

export type SeedSystemTemplateOptions = {
  readonly slug: string;
  readonly kind: RenderKind;
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

  const existing = (await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    slug: opts.slug,
    kind: opts.kind,
    locale: opts.locale,
  })) as { id: string; version: number } | null;

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

