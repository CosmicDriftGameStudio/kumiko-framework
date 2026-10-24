// TemplateResolverApi — cross-feature interface. renderer-foundation,
// delivery and apps import types ONLY and take the implementation from
// ctx.templateResolver at runtime.

import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { FileAttachmentRef } from "../renderer-foundation/index.ts";
import {
  fileAttachmentsOf,
  imageLinksOf,
  parseLinkedResourceEntries,
  pdfAttachmentLinksOf,
  type TemplatePdfAttachmentLink,
} from "./linked-resources.ts";
import { type TemplateResourceRow, templateResourcesTable } from "./table.ts";
import {
  deliveryPolicyOf,
  isRowServed,
  isServedByCollectionOnly,
  type TemplateDeliveryPolicy,
} from "./template-delivery-policy.ts";
import { activeVersionOf, isSystemAdmin, servedVersionOf } from "./template-draft.ts";
import { parseTemplateMeta, type TemplateMeta } from "./template-meta.ts";
import type { ContentFormat, TemplateKind } from "./web/constants.ts";
import { FALLBACK_LOCALE, SYSTEM_TENANT_ID } from "./web/constants.ts";

// Public TemplateResource: what consumers see. Hides DB-internal columns
// (insertedById, internal id-type) but keeps the fields needed for rendering.
export type TemplateResource = {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: TemplateKind;
  readonly locale: string;
  readonly title: string | null;
  readonly folder: string | null;
  readonly content: string;
  readonly contentFormat: ContentFormat;
  readonly variableSchema: Record<string, unknown>;
  /** Embeddable images: resource key -> fileRef id. */
  readonly linkedResources: Record<string, string>;
  /** Files attached to every mail rendered from this template, ordered by key. */
  readonly fileAttachments?: readonly FileAttachmentRef[];
  /** PDFs rendered from document templates and attached at send time, ordered by key. */
  readonly pdfAttachmentLinks?: readonly TemplatePdfAttachmentLink[];
  /** Parsed per kind; null when absent or when the stored JSON no longer
   *  matches the kind's schema (the renderer then fails with a clear error). */
  readonly meta: TemplateMeta | null;
  readonly scope: "system" | "tenant";
  readonly parentTemplateId: string | null;
  readonly status: "draft" | "active" | "archived";
  readonly modifiedAt: Temporal.Instant | null;
};

export type ResolveRequest = {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly kind: TemplateKind;
  readonly locale: string;
};

export type LayoutKind = "mail-layout" | "pdf-layout";

export type ResolveLayoutRequest = {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly kind: LayoutKind;
  readonly locale: string;
};

export type TemplateResolverApi = {
  /**
   * Raw lookup by (tenantId, slug, kind, locale): no locale fallback, no override
   * hierarchy. Render paths must use `resolveTemplate`. `scope: "system"` forces
   * SYSTEM_TENANT_ID and ignores the passed tenantId.
   *
   * Tenant rows of a template that is not tenantEditable are not returned.
   */
  readonly findExact: (args: {
    readonly tenantId: TenantId;
    readonly slug: string;
    readonly kind: TemplateKind;
    readonly locale: string;
    readonly scope?: "system";
  }) => Promise<TemplateResource | null>;

  /**
   * Four-step fallback: tenant+locale, system+locale, tenant+FALLBACK_LOCALE,
   * system+FALLBACK_LOCALE (see template-resolver.md).
   * Tenant rows count only for templates unlocked for tenants (tenantEditable,
   * or a collection with access); locked overrides are skipped but stay stored.
   */
  readonly resolveTemplate: (args: ResolveRequest) => Promise<TemplateResource>;

  /**
   * Layouts are locale-neutral in the product (the layout editor saves under the locale of the
   * row it loaded), so the locale chain is wider than resolveTemplate: tenant (requested,
   * FALLBACK_LOCALE, any active locale), then system (same). Only active rows count; among
   * "any" the highest version wins, then the alphabetically first locale, so the pick is stable.
   * Throws TemplateNotFoundError when neither scope has an active row.
   *
   * **Caller invariant:** `tenantId` must come from the server, as for `resolveTemplate`.
   */
  readonly resolveLayout: (args: ResolveLayoutRequest) => Promise<TemplateResource>;
};

export function createTemplateResolverApi(
  db: DbRunner | TenantDb,
  registry: Registry,
): TemplateResolverApi {
  const deliveryPolicy = deliveryPolicyOf(registry);
  // A collection entry must not shadow a system template of the same slug that the app did not unlock.
  const isServed = (row: TemplateResourceRow) => isRowDelivered(db, deliveryPolicy, row);
  return {
    findExact: async ({ tenantId, slug, kind, locale, scope }) => {
      const effectiveTenantId = scope === "system" ? SYSTEM_TENANT_ID : tenantId;
      const row = await fetchTemplate(db, effectiveTenantId, slug, kind, locale);
      return row && (await isServed(row)) ? toPublic(row) : null;
    },

    resolveTemplate: async ({ tenantId, slug, kind, locale }) => {
      // Fallback-Chain — finde erste passende Variante
      const candidates: ReadonlyArray<{ tid: string; loc: string }> = [
        { tid: tenantId, loc: locale },
        { tid: SYSTEM_TENANT_ID, loc: locale },
        ...(locale !== FALLBACK_LOCALE
          ? [
              { tid: tenantId, loc: FALLBACK_LOCALE },
              { tid: SYSTEM_TENANT_ID, loc: FALLBACK_LOCALE },
            ]
          : []),
      ];
      for (const c of candidates) {
        if (!isRowServed(deliveryPolicy, { tenantId: c.tid, kind, slug })) continue;
        const row = await fetchTemplate(db, c.tid, slug, kind, c.loc);
        if (row && row.status === "active" && (await isServed(row))) return toPublic(row);
      }
      throw new TemplateNotFoundError({ slug, kind, locale });
    },

    resolveLayout: async ({ tenantId, slug, kind, locale }) => {
      for (const tid of [tenantId, SYSTEM_TENANT_ID]) {
        if (!isRowServed(deliveryPolicy, { tenantId: tid, kind, slug })) continue;
        const rows = await selectMany<TemplateResourceRow>(db, templateResourcesTable, {
          tenantId: tid,
          slug,
          kind,
        });
        const row = pickActiveLayoutRow(rows, locale);
        if (row !== null) return toPublic(row);
      }
      throw new TemplateNotFoundError({ slug, kind, locale });
    },
  };
}

type DeliveredRowKey = Pick<TemplateResourceRow, "tenantId" | "kind" | "slug">;

// The one delivery rule for a stored row: unlocked, and a collection entry never shadows a system
// template of the same slug that the app did not unlock.
export async function isRowDelivered(
  db: DbRunner | TenantDb,
  policy: TemplateDeliveryPolicy,
  row: DeliveredRowKey,
): Promise<boolean> {
  if (!isRowServed(policy, row)) return false;
  if (row.tenantId === SYSTEM_TENANT_ID || !isServedByCollectionOnly(policy, row)) return true;
  return !(await systemTemplateExists(db, row.kind, row.slug));
}

export async function isRowDeliveredTo(
  db: DbRunner | TenantDb,
  policy: TemplateDeliveryPolicy,
  user: { readonly roles: readonly string[] },
  row: DeliveredRowKey,
): Promise<boolean> {
  return isSystemAdmin(user) || (await isRowDelivered(db, policy, row));
}

// One system-slug lookup per kind instead of one query per row, because by-tenant is anonymous.
export async function filterDeliveredTo(
  db: DbRunner | TenantDb,
  policy: TemplateDeliveryPolicy,
  user: { readonly roles: readonly string[] },
  rows: readonly TemplateResourceRow[],
): Promise<TemplateResourceRow[]> {
  if (isSystemAdmin(user)) return [...rows];
  const served = rows.filter((row) => isRowServed(policy, row));
  const shadowable = served.filter(
    (row) => row.tenantId !== SYSTEM_TENANT_ID && isServedByCollectionOnly(policy, row),
  );
  const slugsByKind = new Map<string, Set<string>>();
  for (const row of shadowable) {
    const slugs = slugsByKind.get(row.kind) ?? new Set<string>();
    slugs.add(row.slug);
    slugsByKind.set(row.kind, slugs);
  }
  const systemKeys = new Set<string>();
  for (const [kind, slugs] of slugsByKind) {
    const systemRows = await selectMany<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      kind,
      slug: [...slugs],
    });
    for (const systemRow of systemRows) systemKeys.add(`${kind}|${systemRow.slug}`);
  }
  return served.filter(
    (row) =>
      row.tenantId === SYSTEM_TENANT_ID ||
      !isServedByCollectionOnly(policy, row) ||
      !systemKeys.has(`${row.kind}|${row.slug}`),
  );
}

export async function systemTemplateExists(
  db: DbRunner | TenantDb,
  kind: string,
  slug: string,
): Promise<boolean> {
  const rows = await selectMany(
    db,
    templateResourcesTable,
    { tenantId: SYSTEM_TENANT_ID, slug, kind },
    { limit: 1 },
  );
  return rows.length > 0;
}

function pickActiveLayoutRow(
  rows: readonly TemplateResourceRow[],
  locale: string,
): TemplateResourceRow | null {
  const active = rows
    .filter((row) => row.status === "active")
    .sort((a, b) => activeVersionOf(b) - activeVersionOf(a) || a.locale.localeCompare(b.locale));
  return (
    active.find((row) => row.locale === locale) ??
    active.find((row) => row.locale === FALLBACK_LOCALE) ??
    active[0] ??
    null
  );
}

async function fetchTemplate(
  db: DbRunner | TenantDb,
  tenantId: string,
  slug: string,
  kind: TemplateKind,
  locale: string,
): Promise<TemplateResourceRow | null> {
  const rows = await selectMany(
    db,
    templateResourcesTable,
    { tenantId, slug, kind, locale },
    { limit: 1 },
  );
  // @cast-boundary db-row — db.select returnt unbenanntes unknown[],
  // The row shape is guaranteed by templateResourcesTable + buildBaseColumns.
  return (rows[0] as TemplateResourceRow | undefined) ?? null;
}

function toPublic(row: TemplateResourceRow): TemplateResource {
  // @cast-boundary db-row — Drizzle-Schema typisiert kind/contentFormat/
  // scope/status as generic text. Database CHECK constraints restrict
  // them to the union types; the cast asserts that schema knowledge.
  const kind = row.kind as TemplateKind;
  // @cast-boundary db-row — see kind.
  const contentFormat = row.contentFormat as ContentFormat;
  // @cast-boundary db-row — see kind.
  const scope = row.scope as "system" | "tenant";
  // @cast-boundary db-row — see kind.
  const status = row.status as "draft" | "active" | "archived";
  const linkedEntries = parseLinkedResourceEntries(row.linkedResources);
  return {
    id: String(row.id),
    version: servedVersionOf(row),
    tenantId: row.tenantId,
    slug: row.slug,
    kind,
    locale: row.locale,
    title: row.title,
    folder: row.folder,
    content: row.content ?? "",
    contentFormat,
    variableSchema: parseJson(row.variableSchema),
    linkedResources: imageLinksOf(linkedEntries),
    fileAttachments: fileAttachmentsOf(linkedEntries),
    pdfAttachmentLinks: pdfAttachmentLinksOf(linkedEntries),
    meta: parseStoredMeta(kind, row.meta),
    scope,
    parentTemplateId: row.parentTemplateId,
    status,
    modifiedAt: row.modifiedAt,
  };
}

function parseStoredMeta(kind: TemplateKind, raw: string | null): TemplateMeta | null {
  if (!raw) return null;
  try {
    const result = parseTemplateMeta(kind, JSON.parse(raw));
    return result.ok ? result.meta : null;
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // @cast-boundary engine-payload — JSON.parse returnt unknown, typeof-Guard
    // narrows it to object; Record<string, unknown> is the minimal common shape.
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class TemplateNotFoundError extends Error {
  constructor(public readonly query: { slug: string; kind: TemplateKind; locale: string }) {
    super(
      `[template-resolver] no template found for slug="${query.slug}" kind="${query.kind}" locale="${query.locale}" (checked tenant + system, requested + fallback locale)`,
    );
    this.name = "TemplateNotFoundError";
  }
}

// Single source of truth for "this handler requires template-resolver".
// Pattern symmetric with requireTextContent.
export function requireTemplateResolver(
  ctx: { readonly services: { readonly extensions: Readonly<Record<string, unknown>> } },
  callerName: string,
): TemplateResolverApi {
  // @cast-boundary engine-bridge — templateResolver kommt per extraContext
  // from App-Bootstrap and lands in services.extensions; the framework does not know its type.
  const api = ctx.services.extensions["templateResolver"] as TemplateResolverApi | undefined;
  if (!api) {
    throw new InternalError({
      message:
        `[${callerName}] ctx.templateResolver missing — App-Bootstrap muss ` +
        `extraContext: { templateResolver: createTemplateResolverApi(db, registry) } setzen ` +
        `(siehe template-resolver/README.md).`,
    });
  }
  return api;
}

export type { SessionUser };
