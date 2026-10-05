import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { NotificationRenderer } from "../delivery/index.js";
import {
  RENDERER_EXTENSION,
  type RendererContext,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "../renderer-foundation/index.js";
import { resolveNotificationVariables } from "./resolve-variables.js";
import { createSimpleRenderer, type MailBranding, simpleRenderer } from "./simple-renderer.js";

// Adapter: simpleRenderer.render hat `Promise<string>`-Signatur (Legacy
// NotificationRenderer-Contract), renderer-foundation erwartet
// `Promise<RenderResponse>` mit discriminated union. Mapper bewahrt
// die simpleRenderer-Implementierung (Template-Strings → HTML mit
// Inline-CSS) und packt sie in den RendererPlugin-Contract.
//
// Exported damit der Adapter-Pfad direkt testbar ist (unit-test).
export async function adaptToFoundation(
  req: RenderRequest,
  ctx: RendererContext,
  renderer: NotificationRenderer = simpleRenderer,
): Promise<RenderResponse> {
  if (req.kind !== "notification") {
    // Defensiver Guard — Foundation wählt Plugins nur für matching kinds,
    // dieser Pfad sollte unter normalen Umständen nie erreicht werden.
    throw new RendererError(
      `renderer-simple supports only kind="notification", got "${req.kind}"`,
      "invalid_payload",
    );
  }
  const variables = await resolveNotificationVariables(req, ctx);
  const input = { template: req.payload.template ?? "", variables, locale: req.payload.locale };
  const html = await renderer.render(input);
  const text = renderer.renderText ? await renderer.renderText(input) : undefined;
  return text === undefined ? { kind: "notification", html } : { kind: "notification", html, text };
}

export type RendererSimpleOptions = {
  /** Branding applied to every notification mail, including the framework auth mails. */
  readonly mailBranding?: MailBranding;
};

export function createRendererSimpleFeature(options?: RendererSimpleOptions): FeatureDefinition {
  const renderer = options?.mailBranding
    ? createSimpleRenderer(options.mailBranding)
    : simpleRenderer;
  return defineFeature("renderer-simple", (r) => {
    r.describe(
      'Default renderer plugin for `kind="notification"`: takes a structured `EmailTemplateData` variable map (with `header`, `sections[]` of text/button objects, and optional `footer`; falls back to `title`/`body` if no structured fields are present) and returns rendered HTML with inline CSS. Requires `renderer-foundation`; sufficient for plain notification emails \u2014 swap it for `renderer-mail-html` if you need MJML/Markdown layouts.',
    );
    r.uiHints({
      displayLabel: "Renderer \u00b7 Simple",
      category: "notifications",
      recommended: false,
    });
    r.requires("renderer-foundation");
    r.optionalRequires("template-resolver");

    r.useExtension(RENDERER_EXTENSION, "simple", {
      kinds: ["notification"] as const,
      render: (req, ctx) => adaptToFoundation(req, ctx, renderer),
    });
  });
}
