import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildConfigFeatureSchema } from "../build-config-feature-schema";
import { createTenantConfig } from "../config-helpers";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { AccessRule } from "../types/handlers";
import type { NavDefinition } from "../types/nav";
import type { ScreenDefinition, SecretsEditScreenDefinition } from "../types/screen";

// Mirrors the real "secrets" bundled feature just enough to exercise the
// generator: a single writeHandler "set" is all buildConfigFeatureSchema
// checks for (registry.getWriteHandler("secrets:write:set")) to decide the
// secrets screen is "mounted" — the plaintext-storage internals are
// irrelevant to derivation and stay out of this test.
function secretsFeature(roles: readonly string[] = ["TenantAdmin", "Admin", "SystemAdmin"]) {
  return defineFeature("secrets", (r) => {
    r.writeHandler(
      "set",
      z.object({ key: z.string(), value: z.string() }),
      async () => ({ isSuccess: true, data: null }),
      { access: { roles: [...roles] } },
    );
  });
}

function secretsScreen(
  schema: ReturnType<typeof buildConfigFeatureSchema>,
): SecretsEditScreenDefinition {
  const s: ScreenDefinition | undefined = schema.screens.find((x) => x.id === "secrets");
  if (s?.type !== "secretsEdit") throw new Error('no "secretsEdit" screen "secrets"');
  return s;
}

function navById(
  schema: ReturnType<typeof buildConfigFeatureSchema>,
  id: string,
): NavDefinition | undefined {
  return schema.navs.find((n) => n.id === id);
}

describe("buildConfigFeatureSchema — secrets derivation", () => {
  test("mounted secrets feature + declared r.secret() yields exactly one secretsEdit screen", () => {
    const stripe = defineFeature("stripe", (r) => {
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant", required: true });
      r.secret("webhookSecret", {
        label: { en: "Stripe Webhook Secret" },
        hint: { en: "Found in the Stripe dashboard" },
        scope: "tenant",
      });
    });
    const schema = buildConfigFeatureSchema(createRegistry([secretsFeature(), stripe]));

    expect(schema.screens.filter((s) => s.type === "secretsEdit")).toHaveLength(1);
    const screen = secretsScreen(schema);
    expect(screen.secretKeys).toEqual({
      "stripe-api-key": "stripe:secret:api-key",
      "stripe-webhook-secret": "stripe:secret:webhook-secret",
    });
    expect(screen.fieldLabels).toEqual({
      "stripe-api-key": "config.secret.stripe.api-key.label",
      "stripe-webhook-secret": "config.secret.stripe.webhook-secret.label",
    });
    expect(screen.fieldHints).toEqual({
      "stripe-webhook-secret": "config.secret.stripe.webhook-secret.hint",
    });
    expect(screen.requiredFields).toEqual(["stripe-api-key"]);
    expect(schema.translations).toEqual({
      "config.secret.stripe.api-key.label": { en: "Stripe API Key" },
      "config.secret.stripe.webhook-secret.label": { en: "Stripe Webhook Secret" },
      "config.secret.stripe.webhook-secret.hint": { en: "Found in the Stripe dashboard" },
    });
  });

  test("sections group by declaring feature; title only when '<feature>.settings' is a declared translation", () => {
    const stripe = defineFeature("stripe", (r) => {
      r.translations({ keys: { "stripe.settings": { en: "Stripe" } } });
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    const mailer = defineFeature("mailer", (r) => {
      // no r.translations() → no "mailer.settings" key declared anywhere
      r.secret("smtpPassword", { label: { en: "SMTP Password" }, scope: "tenant" });
    });
    const schema = buildConfigFeatureSchema(createRegistry([secretsFeature(), stripe, mailer]));
    const screen = secretsScreen(schema);

    expect(screen.sections).toEqual([
      { fields: ["mailer-smtp-password"] },
      { title: "stripe.settings", fields: ["stripe-api-key"] },
    ]);
    expect(screen.sections.some((s) => "title" in s && s.title === "mailer.settings")).toBe(false);
  });

  test("audience-tenant nav + settings workspace arise from secrets alone (no masked config key)", () => {
    const stripe = defineFeature("stripe", (r) => {
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    const schema = buildConfigFeatureSchema(createRegistry([secretsFeature(), stripe]));

    expect(navById(schema, "audience-tenant")).toBeDefined();
    expect(navById(schema, "secrets")?.parent).toBe("audience-tenant");
    expect(navById(schema, "secrets")?.screen).toBe("secrets");
    expect(schema.workspace).toBeDefined();
    expect(schema.workspace?.navMembers).toContain("config:nav:secrets");
  });

  test("screen and nav access mirror secrets:write:set's access rule, including custom roles", () => {
    const stripe = defineFeature("stripe", (r) => {
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    const customRoles = ["BillingOps"];
    const schema = buildConfigFeatureSchema(createRegistry([secretsFeature(customRoles), stripe]));

    expect(secretsScreen(schema).access).toEqual({ roles: customRoles });
    expect(navById(schema, "secrets")?.access).toEqual({ roles: customRoles });
    expect(navById(schema, "audience-tenant")?.access).toEqual({ roles: customRoles });
  });

  test("audience nav union keeps a granted openToAll's own reason, not the generic ALL_ROLE reason", () => {
    const customReason = "billing key rotation is safe for any signed-in tenant member";
    const secretsOpenToAll = defineFeature("secrets", (r) => {
      r.writeHandler(
        "set",
        z.object({ key: z.string(), value: z.string() }),
        async () => ({ isSuccess: true, data: null }),
        { access: { openToAll: { reason: customReason } } },
      );
    });
    const billing = defineFeature("billing", (r) => {
      r.config({
        keys: { apiKey: createTenantConfig("text", { mask: { title: "billing.api-key" } }) },
      });
      r.secret("apiKey", { label: { en: "Billing API Key" }, scope: "tenant" });
    });
    const schema = buildConfigFeatureSchema(createRegistry([secretsOpenToAll, billing]));

    expect(navById(schema, "audience-tenant")?.access).toEqual({
      openToAll: { reason: customReason },
    });
  });

  test("audience nav union ignores a malformed openToAll — falls back to the role union", () => {
    const secretsMalformedOpenToAll = defineFeature("secrets", (r) => {
      r.writeHandler(
        "set",
        z.object({ key: z.string(), value: z.string() }),
        async () => ({ isSuccess: true, data: null }),
        // @cast-boundary test — simulates JSON/Designer input that doesn't match the static union
        { access: { openToAll: {} } as unknown as AccessRule },
      );
    });
    const billing = defineFeature("billing", (r) => {
      r.config({
        keys: { apiKey: createTenantConfig("text", { mask: { title: "billing.api-key" } }) },
      });
      r.secret("apiKey", { label: { en: "Billing API Key" }, scope: "tenant" });
    });
    const schema = buildConfigFeatureSchema(createRegistry([secretsMalformedOpenToAll, billing]));

    expect(navById(schema, "audience-tenant")?.access).toEqual({
      roles: ["TenantAdmin", "Admin", "SystemAdmin"],
    });
  });

  test("declared secrets without a mounted secrets feature yield no secretsEdit screen and no secrets nav", () => {
    const stripe = defineFeature("stripe", (r) => {
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    const schema = buildConfigFeatureSchema(createRegistry([stripe]));

    expect(schema.screens).toHaveLength(0);
    expect(schema.navs).toHaveLength(0);
  });

  test("generated screen is JSON-safe (no leaked SecretKeyDefinition.redact function)", () => {
    const stripe = defineFeature("stripe", (r) => {
      r.secret("apiKey", {
        label: { en: "Stripe API Key" },
        scope: "tenant",
        redact: (plaintext) => `${plaintext.slice(0, 3)}...`,
      });
    });
    const schema = buildConfigFeatureSchema(createRegistry([secretsFeature(), stripe]));
    const screen = secretsScreen(schema);

    expect(JSON.parse(JSON.stringify(screen))).toEqual(screen);
  });
});
