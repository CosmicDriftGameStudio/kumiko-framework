import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { ContentFormat, RenderKind } from "./constants";

// RenderRequest — Plugins erhalten das. Resource-Mode wählt der Caller
// (renderer-foundation api) je nach kind oder explizit. Plugin selbst
// entscheidet nicht — es bekommt eine schon aufgelöste Form.
export type RenderRequest =
  | { kind: "notification"; payload: NotificationPayload }
  | { kind: "mail-html"; payload: MailHtmlPayload }
  | { kind: "document-pdf"; payload: DocumentPayload; options?: PdfOptions }
  | { kind: "image-snapshot"; payload: DocumentPayload; options?: ImageOptions };

export type RenderResponse =
  | { kind: "notification"; html: string }
  | { kind: "mail-html"; html: string; text: string }
  | { kind: "document-pdf"; pdfBytes: Uint8Array; pageCount: number; sizeBytes: number }
  | { kind: "image-snapshot"; imageBytes: Uint8Array; format: "png" | "jpg"; width: number; height: number };

export type NotificationPayload = {
  readonly template?: string;
  readonly content?: string;
  readonly contentFormat?: ContentFormat;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
};

export type MailHtmlPayload = {
  readonly template?: string;
  readonly content?: string;
  readonly contentFormat?: ContentFormat;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  readonly subject?: string;
};

export type DocumentPayload = {
  readonly template?: string;
  readonly content?: string;
  readonly contentFormat?: ContentFormat;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
};

export type PdfOptions = {
  readonly format?: "A4" | "Letter";
  readonly marginMm?: { top?: number; right?: number; bottom?: number; left?: number };
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
  readonly printBackground?: boolean;
  readonly displayHeaderFooter?: boolean;
};

export type ImageOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly format?: "png" | "jpg";
  readonly quality?: number;
};

// RendererContext — schmale Surface (Kumiko-Style, matcht FileProviderContext
// + ChannelContext). Plugins, die Service-Access brauchen, holen sich
// templateResolver/etc. via direkten Bundle-Import + ctx.db (cross-feature-
// public-API). KEIN extraContext-Pass-Through — Plugin importiert pure-
// Function-Factories statt App-ctx zu casten.
//
// **Beispiel renderer-mail-html:**
//   import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
//   const tplApi = createTemplateResolverApi(ctx.db);
//   const layout = await tplApi.resolveTemplate({ tenantId: ctx.tenantId, slug, kind });
export type RendererContext = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly tenantId: TenantId;
};

// RendererPlugin-Contract — pro Plugin (renderer-simple, renderer-mail-html,
// renderer-puppeteer-client). Plugin deklariert welche kinds es bedienen
// kann; Foundation-Resolver wählt basierend auf Tenant-Config + kind.
//
// **Plugin-Invarianten:**
// - `kinds` muss min. 1 Element haben (sonst nie ausgewählt)
// - `render(req, ctx)`-Response.kind MUSS req.kind matchen
// - Plugin ist zustandslos: kein internal-state zwischen render-Calls
// - Plugin wirft `RendererError` für domain-Fehler (nicht bare Error)
// - `ctx` ist required. Plugins ohne Service-Deps (z.B. renderer-simple)
//   ignorieren ihn einfach — TS function-arg variance erlaubt `(req) => ...`-
//   Implementations weiterhin (Implementation-Args ≤ Contract-Args ist OK).
export type RendererPlugin = {
  readonly name: string;
  readonly kinds: ReadonlyArray<RenderKind>;
  render(req: RenderRequest, ctx: RendererContext): Promise<RenderResponse>;
};

export class RendererError extends Error {
  constructor(
    message: string,
    public readonly code: "no_plugin_for_kind" | "invalid_payload" | "other",
  ) {
    super(message);
    this.name = "RendererError";
  }
}
