// TemplateResolverApi — Cross-Feature-Schnittstelle. renderer-foundation
// + delivery + Apps importieren NUR Types und holen die Implementation
// runtime aus ctx.templateResolver. Pattern symmetrisch zu textContent
// (siehe text-content/api.ts).

import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { ContentFormat, RenderKind } from "./constants";
import { FALLBACK_LOCALE, SYSTEM_TENANT_ID } from "./constants";
import { type TemplateResourceRow, templateResourcesTable } from "./table";

// Public TemplateResource — was Konsumenten sehen. Versteckt DB-interne
// Spalten (createdBy, internal id-type), behält Felder die zum Rendern
// gebraucht werden.
export type TemplateResource = {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: RenderKind;
  readonly locale: string;
  readonly content: string;
  readonly contentFormat: ContentFormat;
  readonly variableSchema: Record<string, unknown>;
  readonly linkedResources: Record<string, string>;
  readonly scope: "system" | "tenant";
  readonly parentTemplateId: string | null;
  readonly status: "draft" | "active" | "archived";
  readonly updatedAt: Date;
};

export type ResolveRequest = {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly kind: RenderKind;
  readonly locale: string;
};

export type TemplateResolverApi = {
  /**
   * Findet ein konkretes Template by (tenantId, slug, kind, locale).
   * Kein Locale-Fallback, keine Override-Hierarchie — Raw-Lookup für
   * Admin-UI-Edits und Konformitäts-Tests. Für Render-Aufrufe immer
   * `resolveTemplate` nutzen.
   *
   * `scope: "system"` zwingt Lookup gegen SYSTEM_TENANT_ID (ignoriert
   * den übergebenen tenantId). Default = Lookup gegen den übergebenen
   * tenantId direkt (Caller wählt entweder Tenant oder System per
   * tenantId).
   */
  readonly findExact: (args: {
    readonly tenantId: TenantId;
    readonly slug: string;
    readonly kind: RenderKind;
    readonly locale: string;
    readonly scope?: "system";
  }) => Promise<TemplateResource | null>;

  /**
   * Resolver mit 4-Stufen-Fallback (siehe template-resolver.md):
   *   1. tenant + requested-locale
   *   2. system + requested-locale
   *   3. tenant + FALLBACK_LOCALE
   *   4. system + FALLBACK_LOCALE
   * Resource-Substitution wird hier NICHT ausgeführt — das macht der
   * Caller (renderer-foundation-Plugin) je nach kind-passendem Modus
   * (inline-base64 vs. signed-url). API liefert TemplateResource pur.
   *
   * **Caller-Invariante:** `tenantId` MUSS vom Server kommen (typisch
   * `ctx.user.tenantId`). Niemals direkt aus User-Input — sonst kann
   * User cross-tenant Templates abfragen (Tenant-Isolation gebrochen).
   */
  readonly resolveTemplate: (args: ResolveRequest) => Promise<TemplateResource>;
};

export function createTemplateResolverApi(db: DbConnection): TemplateResolverApi {
  return {
    findExact: async ({ tenantId, slug, kind, locale, scope }) => {
      const effectiveTenantId = scope === "system" ? SYSTEM_TENANT_ID : tenantId;
      const row = await fetchTemplate(db, effectiveTenantId, slug, kind, locale);
      return row ? toPublic(row) : null;
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
        const row = await fetchTemplate(db, c.tid, slug, kind, c.loc);
        if (row && row.status === "active") return toPublic(row);
      }
      throw new TemplateNotFoundError({ slug, kind, locale });
    },
  };
}

async function fetchTemplate(
  db: DbConnection,
  tenantId: string,
  slug: string,
  kind: RenderKind,
  locale: string,
): Promise<TemplateResourceRow | null> {
  const rows = await selectMany(db, templateResourcesTable, { tenantId, slug, kind, locale }, { limit: 1 });
  // @cast-boundary db-row — db.select returnt unbenanntes unknown[],
  // Row-Shape ist via templateResourcesTable + buildBaseColumns garantiert.
  return (rows[0] as TemplateResourceRow | undefined) ?? null;
}

function toPublic(row: TemplateResourceRow): TemplateResource {
  // @cast-boundary db-row — Drizzle-Schema typisiert kind/contentFormat/
  // scope/status als generic text. CHECK-Constraints in der DB schränken
  // sie auf die Union-Types ein; Cast assertet das Schema-Wissen.
  // linkedResources ist ein text-column mit JSON-payload (string→string map).
  const kind = row.kind as RenderKind;
  // @cast-boundary db-row — siehe kind.
  const contentFormat = row.contentFormat as ContentFormat;
  // @cast-boundary db-row — siehe kind.
  const scope = row.scope as "system" | "tenant";
  // @cast-boundary db-row — siehe kind.
  const status = row.status as "draft" | "active" | "archived";
  // @cast-boundary db-row — parseJson returnt Record<string, unknown>;
  // linkedResources-Spalte enthält per Schema {key: signedUrl}-Map.
  const linkedResources = parseJson(row.linkedResources) as Record<string, string>;
  return {
    id: String(row.id),
    version: row.version,
    tenantId: row.tenantId,
    slug: row.slug,
    kind,
    locale: row.locale,
    content: row.content ?? "",
    contentFormat,
    variableSchema: parseJson(row.variableSchema),
    linkedResources,
    scope,
    parentTemplateId: row.parentTemplateId,
    status,
    updatedAt: row.updatedAt,
  };
}

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // @cast-boundary engine-payload — JSON.parse returnt unknown, typeof-Guard
    // grenzt auf object ein; Record<string, unknown> ist der minimale common-shape.
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class TemplateNotFoundError extends Error {
  constructor(public readonly query: { slug: string; kind: RenderKind; locale: string }) {
    super(
      `[template-resolver] no template found for slug="${query.slug}" kind="${query.kind}" locale="${query.locale}" (checked tenant + system, requested + fallback locale)`,
    );
    this.name = "TemplateNotFoundError";
  }
}

// Single point of truth für "dieser Handler braucht template-resolver".
// Pattern symmetrisch zu requireTextContent.
export function requireTemplateResolver(
  ctx: { readonly templateResolver?: TemplateResolverApi } | object,
  callerName: string,
): TemplateResolverApi {
  // @cast-boundary engine-bridge — templateResolver kommt per extraContext
  // aus App-Bootstrap, Framework-Container kennt das Feld nicht von sich aus.
  const api = (ctx as { templateResolver?: TemplateResolverApi }).templateResolver;
  if (!api) {
    throw new InternalError({
      message:
        `[${callerName}] ctx.templateResolver missing — App-Bootstrap muss ` +
        `extraContext: { templateResolver: createTemplateResolverApi(db) } setzen ` +
        `(siehe template-resolver/README.md).`,
    });
  }
  return api;
}

export type { SessionUser };
