import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { BRANDING_FEATURE } from "./constants.ts";
import { createBrandingTokensQuery } from "./handlers/tokens.query.ts";
import { BRANDING_KEYS, CUSTOM_CSS_KEY } from "./keys.ts";
import { createBrandingSettingsScreen } from "./screens/branding-settings-screen.ts";
import { BRANDING_I18N } from "./web/i18n.ts";

export type BrandingOptions = {
  /** Enables the per-tenant custom CSS capability (raw, untrusted): a
   *  `custom-css` config key + a CSS field in the branding editor +
   *  render emission as a scoped, allowlist-sanitized `<style data-tenant-css>`.
   *  Default **false** (fail-closed — opt-in for untrusted tenant input). Even
   *  when true, emission is additionally gated per tenant by the
   *  `branding-css` toggle (createBrandingCssFeature) once a
   *  feature-toggles/tier-engine runtime is wired. The render-time sanitizer
   *  (page-render/css-sanitize) is the safety boundary. */
  readonly allowCustomCss?: boolean;
};

// branding — tenant branding tokens as their own feature, so mail and PDF
// renderers and the document designer get them without mounting public pages.
export function createBrandingFeature(opts: BrandingOptions = {}): FeatureDefinition {
  const allowCustomCss = opts.allowCustomCss ?? false;

  return defineFeature(BRANDING_FEATURE, (r) => {
    r.describe(
      "Tenant branding tokens (title, description, site URL, accent colour, logo, layout preset, optional custom CSS) read by managed pages, mail and PDF renderers and the document designer; set via config:write:set on branding:config:*, read via branding:query:tokens. Keys are write-validated (hex colour, https URLs, FileRef id) and readable anonymously so public pages can render them; a configEdit self-service screen (`branding:screen:branding-settings`) edits them. Raw custom CSS exists only when the app passes allowCustomCss and is additionally gated per tenant by the branding-css toggle. Requires `config`.",
    );
    r.uiHints({
      displayLabel: "Branding",
      category: "content",
      recommended: false,
    });
    r.requires({ features: ["config"] });

    // The raw-CSS key is added only when allowCustomCss (fail-closed: no
    // key/editor when the capability is off).
    r.config({ keys: allowCustomCss ? { ...BRANDING_KEYS, ...CUSTOM_CSS_KEY } : BRANDING_KEYS });

    const queries = { tokens: r.queryHandler(createBrandingTokensQuery({ allowCustomCss })) };
    r.screen(createBrandingSettingsScreen({ allowCustomCss }));
    r.translations({ keys: BRANDING_I18N });

    return { queries };
  });
}
