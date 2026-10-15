// Boot/seed helper for app authors. Writes system templates (tenantId=
// SYSTEM_TENANT_ID, scope=system, status=active) idempotently — same projection
// path as the upsertSystem handler, without the access check.
//
// Use it from runProdApp seeds or TenantCreated hooks that install the welcome,
// incident or feature mail slugs, so renderer-simple (or mail) can resolve them
// through the template-resolver.
//
// Default ifExists="skip". The actor is `createSystemUser(SYSTEM_TENANT_ID)`,
// deliberately not TestUsers (prod seeds are not test utilities).

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
  type Registry,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  getStreamVersion,
  getUnscopedStreamMaxVersionForSeed,
} from "@cosmicdrift/kumiko-framework/event-store";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";
import { type ContentFormat, TEXT_BLOCK_KIND, type UpsertKind } from "./constants.js";
import { sanitizeTemplateBody } from "./document-sanitizer.js";
import { executor } from "./handlers/shared.js";
import { TEMPLATE_RESOLVER_FEATURE } from "./qualified-names.js";
import { type TemplateResourceRow, templateResourcesTable } from "./table.js";
import { parseTemplateMeta, templateSlugSchema } from "./template-meta.js";
import {
  hasPlaceholderProblems,
  validateTemplatePlaceholders,
  variablesFromSchema,
} from "./template-validation.js";

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
    // The cast strips the executor-only brand that WritableTable rejects; the orphan row has no events, so no executor verb applies.
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
  readonly meta?: unknown;
  readonly parentTemplateId?: string | null;
  readonly by?: SessionUser;
  readonly ifExists?: SeedIfExists;
};

export async function seedSystemTemplate(
  db: DbConnection,
  opts: SeedSystemTemplateOptions,
): Promise<{ id: string }> {
  const tenantId = SYSTEM_TENANT_ID;
  const by = opts.by ?? createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, "system");

  const body = sanitizeTemplateBody({
    kind: opts.kind,
    contentFormat: opts.contentFormat,
    content: opts.content,
  });
  if (!body.ok) {
    const messages = body.violations.map((item) => item.message);
    throw new Error(
      `seedSystemTemplate ${opts.slug}/${opts.kind}/${opts.locale} rejected: ${messages.join("; ")}`,
    );
  }

  const label = `seedSystemTemplate ${opts.slug}/${opts.kind}/${opts.locale}`;
  const slug = templateSlugSchema.safeParse(opts.slug);
  if (!slug.success) throw new Error(`${label} rejected: ${slug.error.issues[0]?.message}`);
  const parsedMeta = parseTemplateMeta(opts.kind, opts.meta);
  if (!parsedMeta.ok) {
    throw new Error(
      `${label} rejected: ${parsedMeta.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
    );
  }
  if (opts.kind === "mail") {
    const validation = validateTemplatePlaceholders({
      body: body.content ?? "",
      meta: parsedMeta.meta,
      variables: variablesFromSchema(opts.variableSchema ?? {}),
    });
    if (hasPlaceholderProblems(validation)) {
      throw new Error(
        `${label} rejected: unknown placeholders [${validation.unknown.join(", ")}], unused required variables [${validation.missingRequired.join(", ")}]`,
      );
    }
  }

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
  const meta = parsedMeta.meta === null ? null : JSON.stringify(parsedMeta.meta);
  const linkedResources = JSON.stringify(opts.linkedResources ?? {});
  const parentTemplateId = opts.parentTemplateId ?? null;

  const rowFields = {
    slug: opts.slug,
    kind: opts.kind,
    locale: opts.locale,
    content: body.content,
    contentFormat: opts.contentFormat,
    variableSchema,
    linkedResources,
    meta,
    title: null,
    folder: null,
    scope: "system" as const,
    parentTemplateId,
    status: "active" as const,
  };

  const applyUpdate = async (
    row: { id: string; version: number },
    current: TemplateResourceRow | null | undefined,
  ): Promise<{ id: string }> => {
    // Skip no-op updates so re-seeding on every pod boot does not bump
    // version/modifiedAt or grow the event store.
    if (
      current?.content === rowFields.content &&
      current?.contentFormat === rowFields.contentFormat &&
      current?.title === rowFields.title &&
      current?.variableSchema === rowFields.variableSchema &&
      current?.meta === rowFields.meta &&
      current?.linkedResources === rowFields.linkedResources
    ) {
      return { id: String(row.id) };
    }
    const result = await executor.update(
      { id: row.id, version: row.version, changes: rowFields },
      by,
      tdb,
    );
    if (!result.isSuccess) {
      throw new Error(`seedSystemTemplate update failed: ${JSON.stringify(result)}`);
    }
    return { id: String(row.id) };
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
          // Race loser goes through the same skip/update contract as a normal re-seed.
          return runEventStoreSeed({
            existing: resolved,
            ifExists: opts.ifExists,
            create: () => Promise.reject(new Error("seedSystemTemplate: unreachable create")),
            update: (row) => applyUpdate(row, again),
          });
        }
        throw new Error(`seedSystemTemplate create failed: ${JSON.stringify(result)}`);
      }
      const data = result.data as Partial<TemplateResourceRow>;
      if (data.id === undefined) {
        throw new Error("seedSystemTemplate: executor.create did not return an id");
      }
      return { id: String(data.id) };
    },
    update: (row) => applyUpdate(row, existingRow),
  });
}

export function hasNotificationTemplates(registry: Registry): boolean {
  return Array.from(registry.getAllNotifications().values()).some(
    (notification) => notification.template !== undefined,
  );
}

// Boot seed for notifications that ship their mail text with the code
// (`r.notification({ template, meta, variables })`). The code is authoritative,
// so existing system rows are updated; tenant overrides are untouched.
export async function seedNotificationTemplates(
  db: DbConnection,
  registry: Registry,
): Promise<void> {
  const hasTemplates = hasNotificationTemplates(registry);
  if (hasTemplates && registry.getFeature(TEMPLATE_RESOLVER_FEATURE) === undefined) {
    throw new Error(
      `Notifications declare a mail template but the "${TEMPLATE_RESOLVER_FEATURE}" feature is not mounted`,
    );
  }
  if (hasTemplates) {
    // Dynamic: renderer-foundation imports this feature's barrel, a static import would cycle.
    const { collectRendererPlugins } = await import("../renderer-foundation/index.js");
    if (!collectRendererPlugins(registry).some((plugin) => plugin.kinds.includes("mail"))) {
      throw new Error(
        'Notifications declare a mail template but no renderer plugin for kind "mail" is registered (mount renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html)',
      );
    }
  }
  for (const [slug, notification] of registry.getAllNotifications()) {
    for (const [locale, { body }] of Object.entries(notification.template ?? {})) {
      await seedSystemTemplate(db, {
        slug,
        kind: "mail",
        locale,
        content: body,
        contentFormat: "html",
        meta: notification.meta?.[locale],
        variableSchema: notification.variables,
        ifExists: "update",
      });
    }
  }
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

  const applyUpdate = async (
    row: { id: string; version: number },
    current: TemplateResourceRow | null | undefined,
  ): Promise<{ id: string }> => {
    // Skip no-op updates so a legal re-seed on every pod boot does not bump
    // version/modifiedAt (ETag, "last changed", event-store growth).
    if (
      current?.title === fields.title &&
      current?.content === fields.content &&
      current?.folder === fields.folder
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
          // Race loser goes through the same skip/no-op/update contract as a normal re-seed.
          return runEventStoreSeed({
            existing: resolved,
            ifExists: opts.ifExists,
            create: () => Promise.reject(new Error("seedTextBlock: unreachable create")),
            update: (row) => applyUpdate(row, again),
          });
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
    update: (row) => applyUpdate(row, existingRow),
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
  const tenantId = opts.tenantId ?? SYSTEM_TENANT_ID;
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
