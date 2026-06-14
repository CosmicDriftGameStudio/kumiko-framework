// TextContentApi — die Cross-Feature-Schnittstelle des text-content-
// Features. Andere Features (z.B. legal-pages) importieren NUR den Type
// hier und holen die Implementation runtime aus ctx.textContent.
//
// Pattern symmetrisch zu config: das Feature exportiert API-Type +
// Factory, App-Bootstrap setzt die Instance via extraContext, consuming-
// Features nutzen sie via require-Helper aus dem HandlerContext. So
// bleiben Features durch Refactorings entkoppelt — wer textBlocksTable
// umzieht oder die Query-Signatur ändert, muss nur die Factory anpassen.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { type TextBlockRow, textBlocksTable } from "./table";

export type TextBlock = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly updatedAt: Date;
};

export type TextContentApi = {
  /**
   * Lookup eines TextBlocks by (tenantId, slug, lang). Null wenn nicht
   * existiert. Tenant-Scope wird vom Caller mitgegeben — kein implicit
   * tenantId aus Session, weil die API auch von Boot-Jobs ohne
   * Session-User aufgerufen wird (siehe legal-pages bootCheck).
   */
  readonly getBlock: (args: {
    tenantId: TenantId;
    slug: string;
    lang: string;
  }) => Promise<TextBlock | null>;
};

// @wrapper-known semantic-alias
export function createTextContentApi(db: DbConnection): TextContentApi {
  return {
    getBlock: async ({ tenantId, slug, lang }) => {
      const row = await fetchOne<TextBlockRow>(db, textBlocksTable, { tenantId, slug, lang });
      if (!row) return null;
      return {
        slug: row.slug,
        lang: row.lang,
        title: row.title,
        body: row.body,
        updatedAt: row.updatedAt,
      };
    },
  };
}

// Single point of truth für "dieser Handler braucht text-content".
// Wirft InternalError mit Wiring-Hinweis statt bare Error — so liest
// die Debug-Session die exakte Boot-Lücke ("text-content feature not
// wired into AppContext") statt eines generischen undefined-bugs.
//
// Pattern symmetrisch zu requireConfigResolver/requireConfigEncryption.
// Akzeptiert HandlerContext + AppContext (Job-Context) — beide haben
// SharedContextFields als Basis. Das narrowing geschieht via shape-check
// auf das optionale `textContent`-Feld (kein Type-Lookup ins framework).
export function requireTextContent(
  ctx: { readonly textContent?: TextContentApi } | object,
  callerName: string,
): TextContentApi {
  // @cast-boundary engine-bridge ctx ist Framework-Container (HandlerContext
  // | AppContext), textContent kommt per extraContext aus dem App-Bootstrap.
  const api = (ctx as { textContent?: TextContentApi }).textContent;
  if (!api) {
    throw new InternalError({
      message:
        `[${callerName}] ctx.textContent missing — App-Bootstrap muss ` +
        `extraContext: { textContent: createTextContentApi(db) } setzen ` +
        `(siehe text-content/README.md).`,
    });
  }
  return api;
}

// Re-export für Test-Helper die selbst eine Session-User-scoped Variante
// brauchen — der Standard-Use-Case (Routes/Boot-Jobs) gibt tenantId
// explizit mit, deshalb ist getBlock session-agnostisch.
export type { SessionUser };
