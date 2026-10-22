import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature.ts";
import { createManagedPagesFeature } from "../feature.ts";

// Completeness gate: managed-pages now calls r.translations, so the boot validator
// enforces the complete required surface-key set (screen:*.title,
// entity:*:field:*, section headers, and rowAction labels/confirms) in de+en. If a
// single key is missing, validateBoot throws. Both allowCustomCss variants must boot;
// when true, the two customCss keys are also required.

const resolveApexTenant = () => null;

describe("managed-pages i18n surface completeness", () => {
  test("boot-validates with allowCustomCss: false", () => {
    const features = [
      createConfigFeature(),
      createManagedPagesFeature({ resolveApexTenant, allowCustomCss: false }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("boot-validates with allowCustomCss: true (customCss keys required)", () => {
    const features = [
      createConfigFeature(),
      createManagedPagesFeature({ resolveApexTenant, allowCustomCss: true }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });
});
