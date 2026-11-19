import {
  type RenderedTemplateRef,
  type RendererContext,
  RendererError,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  type MailTemplateMeta,
  readLayoutRegions,
  resolveTrustedLayout,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { DEFAULT_MAIL_LAYOUT_SLUG } from "./default-layout.ts";
import {
  collectRegionResourceKeys,
  describeError,
  LOGO_RESOURCE_KEY,
  readBrandingLogo,
  resolveResourceFileRefs,
} from "./document-kit.ts";

export type ResolvedLayout = {
  readonly content: string;
  readonly format: "mjml" | "html";
  readonly ref: RenderedTemplateRef | null;
  readonly template: TemplateResource | null;
  readonly appearanceMeta: unknown;
  readonly fileRefs?: ReadonlyMap<string, string>;
  /** Set for the in-code layout: its header is the brand row built in code. */
  readonly brandHeader?: { readonly hasLogo: boolean };
};

// Without a seeded layout every mail still carries the tenant's branding: accent
// line and button color, and a brand row with the logo (or an initial tile) and the name.
const IN_CODE_LAYOUT_META = {
  accentLine: "branding",
  width: 640,
  outerBackground: "#ecedea",
} as const;

export async function inCodeLayout(ctx: RendererContext): Promise<ResolvedLayout> {
  const logoFileRefId = await readBrandingLogo(ctx);
  return {
    content: "<div data-content></div>",
    format: "html",
    ref: null,
    template: null,
    appearanceMeta: IN_CODE_LAYOUT_META,
    brandHeader: { hasLogo: logoFileRefId !== undefined },
    fileRefs:
      logoFileRefId === undefined ? new Map() : new Map([[LOGO_RESOURCE_KEY, logoFileRefId]]),
  };
}

export async function resolveMailLayout(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  meta: MailTemplateMeta,
  locale: string,
): Promise<ResolvedLayout | null> {
  const slug = meta.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG;
  try {
    const layout = await resolveTrustedLayout(tplApi, {
      tenantId: ctx.tenantId,
      slug,
      kind: "mail-layout",
      locale,
    });
    return {
      content: layout.content,
      format: layout.contentFormat === "html" ? "html" : "mjml",
      ref: { templateId: layout.id, templateVersion: layout.version, scope: layout.scope },
      template: layout,
      appearanceMeta: layout.meta,
    };
  } catch (e) {
    // Only "no layout seeded" falls back to the in-code layout. Connection or
    // schema errors must not be masked, or every mail silently loses its branding.
    if (!(e instanceof TemplateNotFoundError)) {
      throw new RendererError(
        `renderer-mail-html: layout resolution failed — ${describeError(e)}`,
        "other",
      );
    }
    return null;
  }
}

export async function resolveLayoutFileRefs(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  layout: ResolvedLayout,
): Promise<ReadonlyMap<string, string>> {
  if (layout.fileRefs !== undefined) return layout.fileRefs;
  if (layout.format !== "html" || layout.template === null) return new Map();
  try {
    return await resolveResourceFileRefs(
      tplApi,
      ctx,
      layout.template,
      collectRegionResourceKeys(readLayoutRegions(layout.content)),
    );
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: resolving the layout images failed — ${describeError(e)}`,
      "other",
    );
  }
}
