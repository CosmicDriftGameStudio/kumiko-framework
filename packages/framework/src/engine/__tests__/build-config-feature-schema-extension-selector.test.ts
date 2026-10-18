import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { requiredKeysFromScreen } from "../../i18n/required-surface-keys.js";
import { SETTINGS_HUB_I18N } from "../../i18n/settings-hub-keys.js";
import { validateBoot } from "../boot-validator.js";
import { buildConfigFeatureSchema, SETTINGS_HUB_FEATURE } from "../build-config-feature-schema.js";
import { access, createSystemConfig, createTenantConfig } from "../config-helpers.js";
import { defineFeature } from "../define-feature.js";
import { selectablePluginIds } from "../extension-selector-plugins.js";
import { createRegistry } from "../registry.js";
import type {
  ConfigEditScreenDefinition,
  FeatureDefinition,
  ScreenDefinition,
} from "../types/index.js";

const TENANT_ADMIN_WRITE = access.roles("TenantAdmin", "Admin");

function secretsFeature() {
  return defineFeature("secrets", (r) => {
    r.writeHandler({
      name: "set",
      schema: z.object({ key: z.string(), value: z.string() }),
      handler: async () => ({ isSuccess: true, data: null }),
      access: { roles: ["TenantAdmin", "Admin", "SystemAdmin"] },
    });
  });
}

function mailFoundation(extra?: (r: Parameters<Parameters<typeof defineFeature>[1]>[0]) => void) {
  return defineFeature("mail-foundation", (r) => {
    r.translations({
      keys: {
        "mail-foundation.settings": { en: "Mail", de: "Mail-Versand" },
        "mail-foundation.settings.tenant": { en: "Mail (tenant)", de: "Mail (Mandant)" },
      },
    });
    r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
    const keys = r.config({
      keys: {
        provider: createTenantConfig("text", {
          default: "",
          write: TENANT_ADMIN_WRITE,
          mask: { title: "mail.provider", order: 1, icon: "mail" },
        }),
      },
    });
    r.extensionSelector("mailTransport", keys.provider);
    extra?.(r);
  });
}

const smtp = defineFeature("mail-smtp", (r) => {
  r.requires({ features: ["mail-foundation"] });
  r.useExtension("mailTransport", "smtp");
  r.config({
    keys: {
      host: createTenantConfig("text", {
        default: "",
        write: TENANT_ADMIN_WRITE,
        mask: { title: "smtp.host" },
      }),
      relay: createSystemConfig("text", {
        default: "",
        write: access.systemAdmin,
        mask: { title: "smtp.relay" },
      }),
    },
  });
  r.secret("password", { label: { en: "SMTP password" }, scope: "tenant", required: true });
});

const inmemory = defineFeature("mail-inmemory", (r) => {
  r.requires({ features: ["mail-foundation"] });
  r.useExtension("mailTransport", "inmemory");
  r.config({
    keys: {
      capture: createTenantConfig("boolean", {
        write: TENANT_ADMIN_WRITE,
        mask: { title: "inmemory.capture" },
      }),
    },
  });
});

const stripe = defineFeature("stripe", (r) => {
  r.secret("apiKey", { label: { en: "Stripe key" }, scope: "tenant" });
});

function build(features: FeatureDefinition[]) {
  return buildConfigFeatureSchema(createRegistry(features));
}

function screenOf<T extends ScreenDefinition["type"]>(
  schema: ReturnType<typeof buildConfigFeatureSchema>,
  id: string,
  type: T,
): Extract<ScreenDefinition, { type: T }> {
  const s = schema.screens.find((x) => x.id === id);
  if (s === undefined || s.type !== type) throw new Error(`no ${type} screen "${id}"`);
  return s as Extract<ScreenDefinition, { type: T }>; // @cast-boundary type checked on the line above
}

const gatedFeatures = () => [secretsFeature(), mailFoundation(), smtp, inmemory, stripe];

describe("buildConfigFeatureSchema — extension selector", () => {
  test("selector key renders as select of plugin ids, at every scope it shows up", () => {
    const schema = build(gatedFeatures());
    const selection = screenOf(schema, "mail-foundation-tenant-selection", "configEdit");
    expect(selection.fields["provider"]).toMatchObject({
      type: "select",
      options: ["inmemory", "smtp"],
    });
  });

  test("selector without any plugin stays a text field", () => {
    const schema = build([mailFoundation()]);
    const screen = screenOf(schema, "mail-foundation-tenant", "configEdit");
    expect(screen.fields["provider"]?.type).toBe("text");
  });

  test("owner tenant screen is a dashboard around one provider form", () => {
    const schema = build(gatedFeatures());
    const dashboard = screenOf(schema, "mail-foundation-tenant", "dashboard");
    expect(dashboard.description).toBeUndefined();
    expect(dashboard.showUpdatedAt).toBe(false);
    expect(dashboard.panels).toEqual([
      {
        kind: "screen",
        id: "selection",
        screen: "mail-foundation-tenant-selection",
        chromeless: true,
      },
    ]);
  });

  test("the provider form holds every provider's settings and secrets, each shown only while it is picked", () => {
    const schema = build(gatedFeatures());
    const form = screenOf(schema, "mail-foundation-tenant-selection", "configEdit");
    expect(form.submitLabel).toBeUndefined();
    expect(form.configKeys).toEqual({
      provider: "mail-foundation:config:provider",
      "mail-inmemory-capture": "mail-inmemory:config:capture",
      "mail-smtp-host": "mail-smtp:config:host",
    });
    expect(form.secretKeys).toEqual({ "mail-smtp-password": "mail-smtp:secret:password" });
    expect(form.fields["mail-smtp-password"]).toMatchObject({ type: "text", writeOnly: true });
    expect(form.fieldLabels?.["mail-smtp-password"]).toBe("config.secret.mail-smtp.password.label");
    expect(form.requiredFields).toEqual(["mail-smtp-password"]);
    expect(form.layout.sections).toEqual([
      {
        title: "config.settings.provider",
        description: "config.settings.extensionSelectorHint",
        fields: ["provider"],
      },
      {
        title: "mail-inmemory.settings",
        fields: [
          { field: "mail-inmemory-capture", visible: { field: "provider", eq: "inmemory" } },
        ],
      },
      {
        title: "mail-smtp.settings",
        fields: [
          { field: "mail-smtp-host", visible: { field: "provider", eq: "smtp" } },
          { field: "mail-smtp-password", visible: { field: "provider", eq: "smtp" } },
        ],
      },
    ]);
  });

  test("a plugin that names its secrets section gets it as an own section", () => {
    const titledSmtp = defineFeature("mail-smtp", (r) => {
      r.requires({ features: ["mail-foundation"] });
      r.useExtension("mailTransport", "smtp");
      r.translations({ keys: { "mail-smtp.settings.secrets": { en: "SMTP sign-in" } } });
      r.secret("password", { label: { en: "SMTP password" }, scope: "tenant" });
    });
    const schema = build([secretsFeature(), mailFoundation(), titledSmtp]);
    const form = screenOf(schema, "mail-foundation-tenant-selection", "configEdit");
    expect(form.layout.sections[1]).toEqual({
      title: "mail-smtp.settings.secrets",
      description: "config.secrets.description",
      fields: [{ field: "mail-smtp-password", visible: { field: "provider", eq: "smtp" } }],
    });
  });

  test("a secret with its own write roles stays on the secrets screen", () => {
    const gatedSecret = defineFeature("mail-smtp", (r) => {
      r.requires({ features: ["mail-foundation"] });
      r.useExtension("mailTransport", "smtp");
      r.config({
        keys: {
          host: createTenantConfig("text", {
            default: "",
            write: TENANT_ADMIN_WRITE,
            mask: { title: "smtp.host" },
          }),
        },
      });
      r.secret("password", {
        label: { en: "SMTP password" },
        scope: "tenant",
        writeRoles: ["SystemAdmin"],
      });
    });
    const schema = build([secretsFeature(), mailFoundation(), gatedSecret]);
    const form = screenOf(schema, "mail-foundation-tenant-selection", "configEdit");
    expect(Object.keys(form.configKeys)).toEqual(["provider", "mail-smtp-host"]);
    expect(form.secretKeys).toBeUndefined();
    expect(Object.keys(screenOf(schema, "secrets", "secretsEdit").secretKeys)).toEqual([
      "mail-smtp-password",
    ]);
  });

  test("a plugin registered as not selectable in settings is no option, but the server still accepts it", () => {
    const testInbox = defineFeature("mail-test-inbox", (r) => {
      r.requires({ features: ["mail-foundation"] });
      r.useExtension("mailTransport", "test-inbox", { selectableInSettings: false });
    });
    const registry = createRegistry([secretsFeature(), mailFoundation(), smtp, testInbox]);
    const form = screenOf(
      buildConfigFeatureSchema(registry),
      "mail-foundation-tenant-selection",
      "configEdit",
    );
    expect(form.fields["provider"]).toMatchObject({ type: "select", options: ["smtp"] });
    expect(selectablePluginIds(registry, "mailTransport")).toEqual(["smtp", "test-inbox"]);
  });

  test("embedded form is dormant and plugin features lose their tenant screens and nav", () => {
    const schema = build(gatedFeatures());
    expect(screenOf(schema, "mail-foundation-tenant-selection", "configEdit").dormant).toBe(true);
    expect(screenOf(schema, "mail-foundation-tenant", "dashboard").dormant).toBeUndefined();
    const screenIds = schema.screens.map((s) => s.id);
    for (const id of ["mail-smtp-tenant", "mail-inmemory-tenant", "mail-smtp-tenant-secrets"]) {
      expect(screenIds).not.toContain(id);
    }

    const navIds = schema.navs.map((n) => n.id);
    expect(navIds).toContain("mail-foundation-tenant");
    expect(navIds).not.toContain("mail-smtp-tenant");
    expect(navIds).not.toContain("mail-inmemory-tenant");
  });

  test("owner nav keeps id/label/screen and the dashboard access is the union incl. secrets", () => {
    const schema = build(gatedFeatures());
    const nav = schema.navs.find((n) => n.id === "mail-foundation-tenant");
    expect(nav).toMatchObject({
      screen: "mail-foundation-tenant",
      label: "mail-foundation.settings.tenant",
      parent: "audience-tenant",
      icon: "mail",
    });
    const dashboard = screenOf(schema, "mail-foundation-tenant", "dashboard");
    expect(dashboard.access).toEqual({ roles: ["TenantAdmin", "Admin", "SystemAdmin"] });
    expect(nav?.access).toEqual(dashboard.access);
    expect(screenOf(schema, "mail-foundation-tenant-selection", "configEdit").access).toEqual(
      dashboard.access,
    );
  });

  test("global secrets screen drops gated secrets", () => {
    const schema = build(gatedFeatures());
    const globalScreen = screenOf(schema, "secrets", "secretsEdit");
    expect(Object.keys(globalScreen.secretKeys)).toEqual(["stripe-api-key"]);
    expect(schema.translations).toMatchObject({
      "config.secret.mail-smtp.password.label": { en: "SMTP password" },
      "config.secret.stripe.api-key.label": { en: "Stripe key" },
    });
  });

  test("global secrets screen and nav vanish when only gated secrets exist; audience nav keeps secrets access", () => {
    const schema = build([secretsFeature(), mailFoundation(), smtp, inmemory]);
    expect(schema.screens.some((s) => s.id === "secrets")).toBe(false);
    expect(schema.navs.some((n) => n.id === "secrets")).toBe(false);
    const audience = schema.navs.find((n) => n.id === "audience-tenant");
    expect(audience?.access).toEqual({ roles: ["TenantAdmin", "Admin", "SystemAdmin"] });
  });

  test("selection panel is titled Provider regardless of the owner's label", () => {
    const schema = build(gatedFeatures());
    expect(schema.translations?.["screen:mail-foundation-tenant-selection.title"]).toEqual({
      en: "Provider",
      de: "Anbieter",
      es: "Proveedor",
    });
  });

  test("plugin system-scope screen and nav stay ungated", () => {
    const schema = build(gatedFeatures());
    expect(screenOf(schema, "mail-smtp-system", "configEdit").dormant).toBeUndefined();
    expect(schema.navs.find((n) => n.id === "mail-smtp-system")).toMatchObject({
      parent: "audience-system",
      screen: "mail-smtp-system",
    });
  });

  test("plugin feature registered under two ids keeps today's behaviour", () => {
    const twice = defineFeature("mail-smtp", (r) => {
      r.useExtension("mailTransport", "smtp");
      r.useExtension("mailTransport", "smtps");
      r.config({
        keys: {
          host: createTenantConfig("text", {
            default: "",
            write: TENANT_ADMIN_WRITE,
            mask: { title: "smtp.host" },
          }),
        },
      });
      r.secret("password", { label: { en: "SMTP password" }, scope: "tenant" });
    });
    const schema = build([secretsFeature(), mailFoundation(), twice, inmemory]);
    expect(schema.navs.map((n) => n.id)).toContain("mail-smtp-tenant");
    expect(screenOf(schema, "mail-smtp-tenant", "configEdit").dormant).toBeUndefined();
    expect(Object.keys(screenOf(schema, "secrets", "secretsEdit").secretKeys)).toEqual([
      "mail-smtp-password",
    ]);
    const form = screenOf(schema, "mail-foundation-tenant-selection", "configEdit");
    expect(Object.keys(form.configKeys)).toEqual(["provider", "mail-inmemory-capture"]);
  });

  test("plugin feature shared by two selectors keeps today's behaviour", () => {
    const otherFoundation = defineFeature("sms-foundation", (r) => {
      r.extendsRegistrar("smsTransport", { onRegister: () => undefined });
      const keys = r.config({
        keys: {
          provider: createTenantConfig("text", {
            default: "",
            write: TENANT_ADMIN_WRITE,
            mask: { title: "sms.provider" },
          }),
        },
      });
      r.extensionSelector("smsTransport", keys.provider);
    });
    const both = defineFeature("mail-smtp", (r) => {
      r.useExtension("mailTransport", "smtp");
      r.useExtension("smsTransport", "gateway");
      r.config({
        keys: {
          host: createTenantConfig("text", {
            default: "",
            write: TENANT_ADMIN_WRITE,
            mask: { title: "smtp.host" },
          }),
        },
      });
    });
    const schema = build([mailFoundation(), otherFoundation, both]);
    expect(schema.navs.map((n) => n.id)).toContain("mail-smtp-tenant");
    expect(schema.screens.find((s) => s.id === "mail-foundation-tenant")?.type).toBe("configEdit");
  });

  test("selector key not visible at tenant scope: no dashboard, plugins untouched", () => {
    const systemOnlyOwner = defineFeature("mail-foundation", (r) => {
      r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
      const keys = r.config({
        keys: {
          provider: createSystemConfig("text", {
            default: "",
            write: access.systemAdmin,
            mask: { title: "mail.provider" },
          }),
        },
      });
      r.extensionSelector("mailTransport", keys.provider);
    });
    const schema = build([systemOnlyOwner, smtp, inmemory]);
    expect(schema.screens.some((s) => s.type === "dashboard")).toBe(false);
    expect(schema.navs.map((n) => n.id)).toContain("mail-smtp-tenant");
    expect(screenOf(schema, "mail-foundation-system", "configEdit").fields["provider"]?.type).toBe(
      "select",
    );
  });

  test("app without a masked selector is unchanged", () => {
    const unmaskedOwner = defineFeature("mail-foundation", (r) => {
      r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
      const keys = r.config({ keys: { provider: createTenantConfig("text", { default: "" }) } });
      r.extensionSelector("mailTransport", keys.provider);
    });
    const schema = build([secretsFeature(), unmaskedOwner, smtp, inmemory, stripe]);
    expect(schema.screens.some((s) => s.type === "dashboard")).toBe(false);
    expect(schema.navs.map((n) => n.id)).toContain("mail-smtp-tenant");
    expect(Object.keys(screenOf(schema, "secrets", "secretsEdit").secretKeys).sort()).toEqual([
      "mail-smtp-password",
      "stripe-api-key",
    ]);
    expect(screenOf(schema, "mail-smtp-tenant", "configEdit").dormant).toBeUndefined();
  });
});

describe("generated selector dashboard — boot validation", () => {
  // Re-registers the GENERATED hub screens on the config stand-in so validateBoot runs
  // its real dashboard/configEdit checks (config keys and secret keys) on them.
  function hubHostFeature(
    rewrite: (screen: ScreenDefinition) => ScreenDefinition = (s) => s,
  ): FeatureDefinition {
    const schema = build(gatedFeatures());
    // i18n coverage of the hub is asserted in the i18n-keys boot test; here every
    // required key is defined so only the screen/panel checks can fail.
    const translationKeys = Object.fromEntries(
      schema.screens
        .flatMap((s) =>
          requiredKeysFromScreen(SETTINGS_HUB_FEATURE, s, { treatDotFormAsKey: true }),
        )
        .map((key) => [key, { en: key }]),
    );
    return defineFeature("config", (r) => {
      r.translations({ keys: { ...translationKeys, ...SETTINGS_HUB_I18N } });
      for (const screen of schema.screens) r.screen(rewrite(screen));
    });
  }

  function withSecretKeys(
    secretKeys: Readonly<Record<string, string>>,
  ): (screen: ScreenDefinition) => ScreenDefinition {
    return (screen) =>
      screen.type === "configEdit" && screen.secretKeys !== undefined
        ? ({ ...screen, secretKeys } satisfies ConfigEditScreenDefinition)
        : screen;
  }

  test("the provider form and its dashboard pass the boot checks", () => {
    expect(() => validateBoot([hubHostFeature(), ...gatedFeatures()])).not.toThrow();
  });

  test("a form field mapped to an undeclared secret is rejected", () => {
    const host = hubHostFeature(withSecretKeys({ "mail-smtp-password": "mail-smtp:secret:nope" }));
    expect(() => validateBoot([host, ...gatedFeatures()])).toThrow(
      /secret "mail-smtp:secret:nope" is not declared/,
    );
  });

  test("a secret mapped onto a readable field is rejected", () => {
    const host = hubHostFeature((screen) =>
      screen.type === "configEdit" && screen.secretKeys !== undefined
        ? {
            ...screen,
            fields: { ...screen.fields, "mail-smtp-password": { type: "text" } },
          }
        : screen,
    );
    expect(() => validateBoot([host, ...gatedFeatures()])).toThrow(/no writeOnly text field/);
  });
});
