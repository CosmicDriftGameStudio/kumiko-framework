// feature.ts contract tests — pin the public surface of the
// Plugin-API-shaped mail-foundation. Provider-specific configs/secrets
// are tested in their own provider-feature (mail-transport-smtp/__tests__).
//
// **Pattern-Vorbild:** mirrors delivery-feature shape — the foundation
// declares an extension-point + a single selector config-key, nothing
// provider-concrete.

import { describe, expect, test } from "bun:test";
import { createRegistry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createMailFoundationFeature, tenantMailTransport } from "../feature.ts";

describe("mailFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(createMailFoundationFeature().name).toBe("mail-foundation");
  });

  test("declares config as a hard requirement (provider-selector lives there)", () => {
    expect(createMailFoundationFeature().requires).toContain("config");
  });

  test("does NOT require secrets — provider-plugins own their own secrets", () => {
    // The foundation knows nothing about SMTP-passwords; only the SMTP
    // plugin-feature requires secrets. This separation lets a Brevo-
    // API-only deployment skip the secrets-feature if Brevo's provider
    // uses tenant-config text-keys instead.
    expect(createMailFoundationFeature().requires).not.toContain("secrets");
  });
});

describe("mailFoundationFeature.exports — typed handles", () => {
  test("exposes the provider-selector handle", () => {
    expect(createMailFoundationFeature().exports.providerConfigKey).toBeDefined();
    expect(createMailFoundationFeature().exports.providerConfigKey.name).toBe(
      "mail-foundation:config:provider",
    );
  });
});

describe("mailFoundationFeature — registers extension-point", () => {
  test("declares the 'mailTransport' extension-point that providers register against", () => {
    // r.extendsRegistrar("mailTransport", ...) lands in
    // feature.registrarExtensions keyed by extension-name.
    expect(createMailFoundationFeature().registrarExtensions["mailTransport"]).toBeDefined();
  });
});

describe("tenantMailTransport", () => {
  test("yields null without a tenant config so the channel falls back to the app transport", async () => {
    const transport = await tenantMailTransport({
      tenantId: SYSTEM_TENANT_ID,
      registry: createRegistry([]),
    });

    expect(transport).toBeNull();
  });
});
