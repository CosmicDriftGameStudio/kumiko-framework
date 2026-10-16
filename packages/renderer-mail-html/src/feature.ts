import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-types/feature";
import { mailHtmlRender } from "./render.js";

// renderer-mail-html: plugin for renderer-foundation, renders `kind="mail"`
// requests to subject + email-safe HTML + plain text.
//
// **Caller pattern:** the caller (e.g. delivery's email-channel) selects the plugin
// via `createRendererForTenant({ tenantId, kind: "mail" })` and calls
// `plugin.render({ kind: "mail", payload: { slug, locale, variables } }, ctx)`.
// The plugin resolves the mail template and its layout itself through
// template-resolver (tenant -> system), so ctx needs `db`, `registry`, `tenantId`
// and optionally `config` for the tenant's currency and branding.
//
// **Layout:** meta.layoutSlug ?? "default", kind "mail-layout". Without a seeded
// layout the in-code DEFAULT_MAIL_LAYOUT_MJML is used, so mail works from day 1.

export function createRendererMailHtmlFeature(): FeatureDefinition {
  return defineFeature("renderer-mail-html", (r) => {
    r.describe(
      'A `renderer-foundation` plugin that handles `RenderRequest { kind: "mail" }` and returns `{ subject, html, text, previewText? }` suitable for sending via `channel-email`. The mail template (`kind: "mail"`, document HTML, subject in `meta`) resolves through `template-resolver`\'s DB fallback, its body is compiled to Handlebars by template-resolver and rendered with escaping, then placed into an MJML layout (`kind: "mail-layout"`, slug `default` unless `meta.layoutSlug` says otherwise, in-code `DEFAULT_MAIL_LAYOUT_MJML` as last resort) that `mjml()` compiles to email-safe table HTML, with `html-to-text` producing the plain-text alternative. Seed an editable system layout with `seedSystemMailLayout(db)`. Requires `renderer-foundation` + `template-resolver`.',
    );
    r.requires("renderer-foundation");
    r.requires("template-resolver");

    r.useExtension("renderer", "mail-html", {
      kinds: ["mail"] as const,
      render: mailHtmlRender,
    });
  });
}
