import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature";
import { createManagedPagesFeature } from "../feature";

// Completeness-Gate: managed-pages ruft jetzt r.translations → der Boot-Validator
// erzwingt den KOMPLETTEN Required-Surface-Key-Satz (screen:*.title,
// entity:*:field:*, Section-Header, rowAction-Labels/Confirms) in de+en. Fehlt
// EIN Key, wirft validateBoot. Beide allowCustomCss-Varianten müssen booten —
// bei true kommen die zwei customCss-Keys als required dazu.

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
