import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigAccessor, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { MailTemplateMeta, PdfPageFormat, TemplateScope } from "../template-resolver/index.js";
import { type ContentFormat, RENDERER_EXTENSION, type RenderKind } from "./constants.js";

// RenderRequest — Plugins erhalten das. Resource-Mode wählt der Caller
// (renderer-foundation api) je nach kind oder explizit. Plugin selbst
// entscheidet nicht — es bekommt eine schon aufgelöste Form.
export type RenderRequest =
  | { kind: "notification"; payload: NotificationPayload }
  | { kind: "mail"; payload: MailPayload }
  | { kind: "document-pdf"; payload: DocumentPayload; options?: PdfOptions }
  | { kind: "image-snapshot"; payload: DocumentPayload; options?: ImageOptions };

export type RenderedTemplateRef = {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly scope: TemplateScope;
};

export type RenderProvenance = {
  readonly template?: RenderedTemplateRef;
  readonly layout?: RenderedTemplateRef;
};

// Image a rendered mail embeds by Content-ID; the send job reads the bytes.
export type InlineAttachmentRef = {
  readonly kind: "inline";
  readonly cid: string;
  readonly fileRefId: string;
};

export type RenderResponse = (
  | { kind: "notification"; html: string; text?: string }
  | {
      kind: "mail";
      subject: string;
      html: string;
      text: string;
      previewText?: string;
      attachments?: readonly InlineAttachmentRef[];
    }
  | { kind: "document-pdf"; pdfBytes: Uint8Array; pageCount: number; sizeBytes: number }
  | {
      kind: "image-snapshot";
      imageBytes: Uint8Array;
      format: "png" | "jpg";
      width: number;
      height: number;
    }
) &
  RenderProvenance;

export type NotificationPayload = {
  readonly template?: string;
  readonly content?: string;
  readonly contentFormat?: ContentFormat;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
};

// An unsaved version of the mail template; rendering it never reads its stored body or subject.
export type MailDraft = {
  readonly content: string;
  readonly meta: MailTemplateMeta;
  readonly variableSchema?: Readonly<Record<string, unknown>>;
};

export type MailPayload = {
  readonly slug: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly unsubscribeUrl?: string;
  readonly draft?: MailDraft;
};

export type DocumentPayload = {
  readonly template?: string;
  readonly content?: string;
  readonly contentFormat?: ContentFormat;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
};

export type PdfOptions = {
  readonly format?: PdfPageFormat;
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
  readonly db: DbRunner | TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  /** Tenant-scoped config for plugins that format by tenant locale/currency
   *  or read branding; plugins fall back to request defaults when absent. */
  readonly config?: ConfigAccessor;
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

// r.useExtension options-shape: `name` is NOT part of the registration
// payload — collectRendererPlugins derives it from the usage's entityName.
export type RendererRegistrationPlugin = Omit<RendererPlugin, "name">;

export function isRendererRegistrationPlugin(o: unknown): o is RendererRegistrationPlugin {
  return (
    typeof o === "object" &&
    o !== null &&
    "kinds" in o &&
    Array.isArray(o.kinds) &&
    "render" in o &&
    typeof o.render === "function"
  );
}

// r.useExtension options-shape, co-located since the framework never imports upward.
declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [RENDERER_EXTENSION]: RendererRegistrationPlugin;
  }
}
