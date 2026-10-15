// renderer-mail-html pipeline:
//   1. Resolve layout via template-resolver (tenant×"mail-layout" →
//      system×"mail-layout" → fallback DEFAULT_MAIL_LAYOUT_MJML)
//   2. Handlebars(content-markdown, variables) — substitute vars in content
//   3. renderSafeMarkdown(markdown) — Markdown → content HTML (raw HTML
//      escaped, unsafe hrefs neutralised — templates are tenant-authored)
//   4. Handlebars(layout-mjml, { ...variables, content: contentHtml }) —
//      put the content HTML into the layout slot
//   5. mjml(layout-mjml-with-content) — MJML → email-safe HTML
//   6. html-to-text(html) — text/plain alternative
//
// The plugin gets `templateResolverApi` via a direct bundle import + `ctx.db`.
// NO extraContext pass-through — Kumiko style (see the RendererContext
// type comment in renderer-foundation/types.ts).
// Type-Comment in renderer-foundation/types.ts).

import { renderSafeMarkdown } from "@cosmicdrift/kumiko-bundled-features/page-render";
import {
  type RendererContext,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverApi,
  TemplateNotFoundError,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import Handlebars from "handlebars";
import { convert as htmlToText } from "html-to-text";
import mjml2html from "mjml";
import { DEFAULT_MAIL_LAYOUT_MJML } from "./default-layout.js";

const LAYOUT_SLUG = "mail-layout";
const DEFAULT_LOCALE = "en";

export async function mailHtmlRender(
  req: RenderRequest,
  ctx: RendererContext,
): Promise<RenderResponse> {
  if (req.kind !== "mail-html") {
    // Foundation selects plugins only for matching kinds; defensive guard.
    throw new RendererError(
      `renderer-mail-html supports only kind="mail-html", got "${req.kind}"`,
      "invalid_payload",
    );
  }

  const { content, variables = {}, locale = DEFAULT_LOCALE } = req.payload;
  if (!content) {
    throw new RendererError(
      `renderer-mail-html: payload.content is required (got empty/undefined)`,
      "invalid_payload",
    );
  }

  // Step 1: Resolve Layout (tenant → system → default-constant fallback)
  const tplApi = createTemplateResolverApi(ctx.db);
  let layoutMjml: string;
  try {
    const layoutTpl = await tplApi.resolveTemplate({
      tenantId: ctx.tenantId,
      slug: LAYOUT_SLUG,
      kind: "mail-html",
      locale,
    });
    layoutMjml = layoutTpl.content;
  } catch (e) {
    // Only "no layout seeded" falls back to the in-code DEFAULT_MAIL_LAYOUT_MJML.
    // Connection/schema/parse errors must NOT be masked silently — otherwise
    // every mail renders without tenant branding when the DB has problems.
    if (!(e instanceof TemplateNotFoundError)) {
      throw new RendererError(
        `renderer-mail-html: layout resolution failed — ${describe(e)}`,
        "other",
      );
    }
    layoutMjml = DEFAULT_MAIL_LAYOUT_MJML;
  }

  // Step 2: Handlebars-Substitution im Markdown-Content
  let renderedMarkdown: string;
  try {
    const contentTpl = Handlebars.compile(content, { strict: false });
    renderedMarkdown = contentTpl(variables);
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: Handlebars compile failed for content — ${describe(e)}`,
      "invalid_payload",
    );
  }

  // Step 3: Markdown → HTML. renderSafeMarkdown (statt vanilla marked):
  // Templates are tenant-authored — raw HTML tokens are escaped,
  // javascript:/data: hrefs neutralised (same core as legal-pages).
  // gfm:false (framework default): no auto-link for bare URLs, no
  // tables/strikethrough — deliberate tradeoff, no mail template uses them.
  const contentHtml = renderSafeMarkdown(renderedMarkdown);

  // Step 4: Handlebars-Substitution im MJML-Layout, content-HTML als Slot
  let mjmlSource: string;
  try {
    const layoutTpl = Handlebars.compile(layoutMjml, { strict: false });
    mjmlSource = layoutTpl({ ...variables, content: contentHtml });
  } catch (e) {
    // "other", not "invalid_payload": the caller's payload is fine — the
    // tenant/system layout template is broken. Misclassifying as invalid_payload
    // tells the caller "fix your content" (no-retry) instead of "fix the template".
    throw new RendererError(
      `renderer-mail-html: Handlebars compile failed for layout — ${describe(e)}`,
      "other",
    );
  }

  // Step 5: MJML compile → Email-safe HTML (mjml@5 ist async)
  const mjmlResult = await mjml2html(mjmlSource, { validationLevel: "soft" });
  const errors = mjmlResult.errors ?? [];
  if (errors.length > 0) {
    const firstErrors = errors
      .slice(0, 3)
      .map((e) => `line ${e.line}: ${e.message}`)
      .join("; ");
    // "other", not "invalid_payload": MJML errors come from the layout
    // template's markup, not the caller's payload (see Step 4 rationale).
    throw new RendererError(
      `renderer-mail-html: MJML compile produced ${errors.length} error(s) — ${firstErrors}`,
      "other",
    );
  }

  // Step 6: text/plain-Alternative via html-to-text
  const text = htmlToText(mjmlResult.html, {
    wordwrap: 80,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
    ],
  });

  return { kind: "mail-html", html: mjmlResult.html, text };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
