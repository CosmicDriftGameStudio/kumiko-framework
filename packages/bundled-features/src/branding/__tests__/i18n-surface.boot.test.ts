import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature.ts";
import { createBrandingFeature } from "../feature.ts";

// Completeness gate: branding calls r.translations, so the boot validator
// enforces the complete required surface-key set (screen:*.title,
// entity:*:field:*, section headers) in de+en. If a single key is missing,
// validateBoot throws. Both allowCustomCss variants must boot; when true, the
// two customCss keys are also required.

describe("branding i18n surface completeness", () => {
  test("boot-validates with allowCustomCss: false", () => {
    const features = [createConfigFeature(), createBrandingFeature({ allowCustomCss: false })];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("boot-validates with allowCustomCss: true (customCss keys required)", () => {
    const features = [createConfigFeature(), createBrandingFeature({ allowCustomCss: true })];
    expect(() => validateBoot(features)).not.toThrow();
  });
});
