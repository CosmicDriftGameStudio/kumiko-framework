// feature.ts contract tests — pin the public surface of the
// Plugin-API-shaped mail-foundation. Provider-specific configs/secrets
// are tested in their own provider-feature (mail-transport-smtp/__tests__).
//
// **Pattern-Vorbild:** mirrors delivery-feature shape — the foundation
// declares an extension-point + a single selector config-key, nothing
// provider-concrete.

import { describe, expect, test } from "bun:test";
import { mailFoundationFeature } from "../feature";

describe("mailFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(mailFoundationFeature.name).toBe("mail-foundation");
  });

  test("declares config as a hard requirement (provider-selector lives there)", () => {
    expect(mailFoundationFeature.requires).toContain("config");
  });

  test("does NOT require secrets — provider-plugins own their own secrets", () => {
    // The foundation knows nothing about SMTP-passwords; only the SMTP
    // plugin-feature requires secrets. This separation lets a Brevo-
    // API-only deployment skip the secrets-feature if Brevo's provider
    // uses tenant-config text-keys instead.
    expect(mailFoundationFeature.requires).not.toContain("secrets");
  });
});

describe("mailFoundationFeature.exports — typed handles", () => {
  test("exposes only the provider-selector config-key", () => {
    const keys = mailFoundationFeature.exports.configKeys;
    expect(keys.provider).toBeDefined();
    // No host/port/from/authUser — those live in the provider-plugin.
    expect((keys as Record<string, unknown>)["host"]).toBeUndefined();
    expect((keys as Record<string, unknown>)["port"]).toBeUndefined();
  });
});

describe("mailFoundationFeature — registers extension-point", () => {
  test("declares the 'mailTransport' extension-point that providers register against", () => {
    // r.extendsRegistrar("mailTransport", ...) lands in
    // feature.registrarExtensions keyed by extension-name.
    expect(mailFoundationFeature.registrarExtensions["mailTransport"]).toBeDefined();
  });
});
