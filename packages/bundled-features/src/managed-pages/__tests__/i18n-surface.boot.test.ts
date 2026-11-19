import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createBrandingFeature } from "../../branding/index.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createManagedPagesFeature } from "../feature.ts";

// Completeness gate: managed-pages calls r.translations, so the boot validator
// enforces the complete required surface-key set (screen:*.title,
// entity:*:field:*, section headers, and rowAction labels/confirms) in de+en. If a
// single key is missing, validateBoot throws. Branding comes from the branding feature.

const resolveApexTenant = () => null;

describe("managed-pages i18n surface completeness", () => {
  test("boot-validates alongside the branding feature", () => {
    const features = [
      createConfigFeature(),
      createBrandingFeature(),
      createManagedPagesFeature({ resolveApexTenant }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });
});
