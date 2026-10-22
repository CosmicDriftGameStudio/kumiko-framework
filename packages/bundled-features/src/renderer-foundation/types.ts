import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigAccessor, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import type {
  LinkedResourceEntry,
  MailTemplateMeta,
  PdfPageFormat,
  PdfTemplateMeta,
  TemplateScope,
} from "../template-resolver/index.ts";
import { type ContentFormat, RENDERER_EXTENSION, type RenderKind } from "./constants.ts";

// RenderRequest — plugins receive this. The caller selects resource mode
// (renderer-foundation API) by kind or explicitly. Plugins do not decide this;
// they receive an already-resolved form.
export type RenderRequest =
  | { kind: "mail"; payload: MailPayload }
  | { kind: "document-pdf"; payload: DocumentPdfPayload; options?: PdfOptions }
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

// A stored file attached as-is; the send job reads the bytes.
export type FileAttachmentRef = {
  readonly kind: "file";
  readonly fileRefId: string;
  readonly fileName: string;
};

// A PDF rendered from a stored document template when the mail is sent, so the job
// payload carries the variables instead of the bytes.
export type RenderedPdfAttachmentRef = {
  readonly kind: "rendered-pdf";
  readonly templateSlug: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly fileName: string;
  readonly locale?: string;
};

export type MailAttachmentRef = InlineAttachmentRef | FileAttachmentRef | RenderedPdfAttachmentRef;

export type RenderResponse = (
  | {
      kind: "mail";
      subject: string;
      html: string;
      text: string;
      previewText?: string;
      fromName?: string;
      replyTo?: string;
      attachments?: readonly MailAttachmentRef[];
    }
  | {
      kind: "document-pdf";
      pdfBytes: Uint8Array;
      pageCount: number;
      sizeBytes: number;
      fileName: string;
    }
  | {
      kind: "image-snapshot";
      imageBytes: Uint8Array;
      format: "png" | "jpg";
      width: number;
      height: number;
    }
) &
  RenderProvenance;

// An unsaved version of the mail template; rendering it never reads its stored body or subject.
export type MailDraft = {
  readonly content: string;
  readonly meta: MailTemplateMeta;
  readonly variableSchema?: Readonly<Record<string, unknown>>;
  /** Images and attachments of the row being edited; absent means those of the stored template. */
  readonly linkedResources?: Readonly<Record<string, LinkedResourceEntry>>;
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

export type DocumentPdfPayload = {
  readonly slug: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
};

// An unsaved version of the document template, like MailDraft.
export type DocumentPdfDraft = {
  readonly content: string;
  readonly meta: PdfTemplateMeta | null;
  readonly variableSchema?: Readonly<Record<string, unknown>>;
};

export type DocumentPreviewRequest = DocumentPdfPayload & { readonly draft?: DocumentPdfDraft };

// What an editor shows for a document: the printable HTML with the values filled in,
// without calling any print service.
export type DocumentPreview = {
  readonly title: string;
  readonly fileName: string;
  readonly bodyHtml: string;
  readonly layout: {
    readonly slug: string;
    readonly scope: TemplateScope;
    readonly headerHtml: string;
    readonly signatureHtml: string;
    readonly footerHtml: string;
  } | null;
  /** Image keys the body or the layout asks for that no file is linked to. */
  readonly missingResourceKeys: readonly string[];
};

export type PdfOptions = {
  readonly format?: PdfPageFormat;
  readonly marginMm?: { top?: number; right?: number; bottom?: number; left?: number };
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
  readonly printBackground?: boolean;
  readonly displayHeaderFooter?: boolean;
  readonly landscape?: boolean;
};

export type ImageOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly format?: "png" | "jpg";
  readonly quality?: number;
};

// RendererContext — a narrow surface (Kumiko-style, matching FileProviderContext
// + ChannelContext). Plugins that need services obtain templateResolver/etc. via
// direct bundle imports + ctx.db (cross-feature public API). No extraContext
// pass-through: plugins import pure function factories instead of casting App-ctx.
//
// **Example renderer-mail-html:**
//   import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
//   const tplApi = createTemplateResolverApi(ctx.db, ctx.registry);
//   const layout = await tplApi.resolveTemplate({ tenantId: ctx.tenantId, slug, kind });
export type RendererContext = {
  readonly db: DbRunner | TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  /** Tenant-scoped config for plugins that read the tenant currency or
   *  branding; plugins fall back to request defaults when absent. */
  readonly config?: ConfigAccessor;
  /** Only plugins that embed resource bytes (PDF) need it; without it images are dropped. */
  readonly filesForTenant?: (tenantId: string) => FileContext | undefined;
};

// RendererPlugin contract — per plugin (renderer-mail-html,
// renderer-puppeteer-client). The plugin declares which kinds it can handle;
// the Foundation resolver selects one based on tenant config + kind.
//
// Plugin invariants:
// - `kinds` has at least one entry, otherwise the plugin is never picked.
// - The response kind of `render(req, ctx)` matches req.kind.
// - Plugins are stateless between render calls.
// - Domain failures throw `RendererError`, not a bare Error.
// - `ctx` is required; plugins without service deps ignore it. Function-arg
//   variance still lets `(req) => ...` implementations satisfy the contract.
export type MailChromeLink = { readonly label: string; readonly url: string };

/** The tenant's mail look with every text resolved for one locale, for pages a
 *  recipient reaches from a mail link. URLs are http(s) only, the logo https only,
 *  the accent color a #rrggbb hex. */
export type MailChrome = {
  readonly tenantName: string;
  readonly brandSuffix: string;
  readonly logoUrl?: string;
  readonly accentColor?: string;
  readonly siteUrl?: string;
  readonly footerText?: string;
  readonly imprint?: MailChromeLink;
  readonly privacy?: MailChromeLink;
};

export type MailChromeRequest = { readonly locale: string };

export type RendererPlugin = {
  readonly name: string;
  readonly kinds: ReadonlyArray<RenderKind>;
  render(req: RenderRequest, ctx: RendererContext): Promise<RenderResponse>;
  /** Optional: plugins that print documents offer a preview that never reaches the print service. */
  previewDocument?(req: DocumentPreviewRequest, ctx: RendererContext): Promise<DocumentPreview>;
  /** Optional: mail plugins hand out their brand row and footer for pages outside a mail. */
  readMailChrome?(req: MailChromeRequest, ctx: RendererContext): Promise<MailChrome>;
};

export class RendererError extends Error {
  constructor(
    message: string,
    public readonly code: "no_plugin_for_kind" | "invalid_payload" | "unavailable" | "other",
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
