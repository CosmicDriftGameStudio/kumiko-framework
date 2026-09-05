import { describe, expect, test } from "bun:test";
import { defineFeature, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature";
import { createSecretsFeature } from "../feature";

// `secrets` is a foundation feature auto-mounted even when `config` is not
// (dev-server scaffold-app.ts FOUNDATION_FEATURES). A declared r.secret()
// makes buildConfigFeatureSchema emit a secretsEdit screen + Settings-Hub
// chrome navs, whose dot-form labels (config.settings.title, etc.) must
// resolve at boot without the config feature present (fw#2577).
function stripeSecret() {
  return defineFeature("stripe", (r) => {
    r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
  });
}

describe("Settings-Hub chrome i18n keys — secrets without config", () => {
  test("boots with only the secrets feature mounted (no config feature)", () => {
    expect(() => validateBoot([createSecretsFeature(), stripeSecret()])).not.toThrow();
  });

  test("boots with both secrets and config mounted", () => {
    expect(() =>
      validateBoot([createSecretsFeature(), createConfigFeature(), stripeSecret()]),
    ).not.toThrow();
  });
});
