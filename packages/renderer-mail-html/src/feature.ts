import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-types/feature";
import { mailHtmlRender } from "./render.js";

// renderer-mail-html — plugin for renderer-foundation, renders
// `kind="mail-html"` requests to email-safe HTML + plain text via
// MJML layout + Markdown content + Handlebars + html-to-text.
//
// **Caller pattern:**
//   1. The caller (e.g. delivery's email-channel) resolves the content template
//      beforehand via template-resolver and puts content + variables in the payload.
//   2. Foundation selects the plugin via `createRendererForTenant({ tenantId,
//      kind: "mail-html" })`.
//   3. The caller invokes `plugin.render(req, ctx)` with ctx={ db, registry,
//      tenantId }. The plugin fetches the layout internally via
//      `createTemplateResolverApi(ctx.db).resolveTemplate({ slug: "mail-layout", ... })`.
//   4. The plugin returns { kind: "mail-html", html, text } — the caller
//      (channel-email) hands that to the mail-transport.
//
// **Tenant branding:** a tenant writes its own "mail-layout" template via
// `template-resolver:upsertTenantTemplate` (kind="mail-html", format=
// "mjml"). The resolver's 4-stage fallback prefers it over system + the
// hardcoded DEFAULT_MAIL_LAYOUT_MJML constant.
//
// **Default without setup:** if neither tenant nor system has a "mail-layout",
// the plugin falls back to DEFAULT_MAIL_LAYOUT_MJML (in-code constant) — the
// app works from day 1 without DB seeding.

export function createRendererMailHtmlFeature(): FeatureDefinition {
  return defineFeature("renderer-mail-html", (r) => {
    r.describe(
      'A `renderer-foundation` plugin that handles `RenderRequest { kind: "mail-html" }` and returns `{ html, text }` suitable for sending via `channel-email`. The pipeline: Handlebars variable substitution \u2192 `marked` Markdown-to-HTML \u2192 injection into an MJML layout \u2192 `mjml()` compiles to email-safe table HTML, with `html-to-text` producing the plain-text alternative. The MJML layout resolves through `template-resolver`\'s 4-stage DB fallback and finally the in-code `DEFAULT_MAIL_LAYOUT_MJML` default \u2014 tenants override it by upserting a `"mail-layout"` template (seed an editable system default with `seedSystemMailLayout(db)`). Requires `renderer-foundation` + `template-resolver`.',
    );
    r.requires("renderer-foundation");
    r.requires("template-resolver");

    r.useExtension("renderer", "mail-html", {
      kinds: ["mail-html"] as const,
      render: mailHtmlRender,
    });
  });
}
