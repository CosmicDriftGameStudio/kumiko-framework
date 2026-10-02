import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { requiredKeysFromScreen } from "../../i18n/required-surface-keys.js";
import { SETTINGS_HUB_I18N } from "../../i18n/settings-hub-keys.js";
import { validateBoot } from "../boot-validator.js";
import { buildConfigFeatureSchema, SETTINGS_HUB_FEATURE } from "../build-config-feature-schema.js";
import { access, createSystemConfig, createTenantConfig } from "../config-helpers.js";
import { defineFeature } from "../define-feature.js";
import { SELECTED_EXTENSIONS_QUERY } from "../extension-selector-plugins.js";
import { createRegistry } from "../registry.js";
import type {
  ConfigEditScreenDefinition,
  FeatureDefinition,
  ScreenDefinition,
  SecretsEditScreenDefinition,
} from "../types/index.js";

const TENANT_ADMIN_WRITE = access.roles("TenantAdmin", "Admin");

function secretsFeature() {
  return defineFeature("secrets", (r) => {
    r.writeHandler(
      "set",
      z.object({ key: z.string(), value: z.string() }),
      async () => ({ isSuccess: true, data: null }),
      { access: { roles: ["TenantAdmin", "Admin", "SystemAdmin"] } },
    );
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
  r.requires("mail-foundation");
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
  r.requires("mail-foundation");
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

  test("owner tenant screen is a dashboard: selection, plugin config panels, plugin secrets panel", () => {
    const schema = build(gatedFeatures());
    const dashboard = screenOf(schema, "mail-foundation-tenant", "dashboard");
    expect(dashboard.description).toBeUndefined();
    expect(dashboard.showUpdatedAt).toBe(false);
    for (const panel of dashboard.panels) {
      if (panel.kind === "screen") expect(panel.chromeless).toBe(true);
    }
    const selection = screenOf(schema, "mail-foundation-tenant-selection", "configEdit");
    const selectionSection = selection.layout.sections[0];
    expect(
      selectionSection && "description" in selectionSection
        ? selectionSection.description
        : undefined,
    ).toBe("config.settings.extensionSelectorHint");
    expect(selection.submitLabel).toBe("config.settings.saveProvider");
    expect(dashboard.panels).toEqual([
      {
        kind: "screen",
        id: "selection",
        screen: "mail-foundation-tenant-selection",
        chromeless: true,
      },
      {
        kind: "screen",
        id: "mail-inmemory-config",
        screen: "mail-inmemory-tenant",
        chromeless: true,
        visibleWhen: { query: SELECTED_EXTENSIONS_QUERY, field: "mailTransport", eq: "inmemory" },
      },
      {
        kind: "screen",
        id: "mail-smtp-config",
        screen: "mail-smtp-tenant",
        chromeless: true,
        visibleWhen: { query: SELECTED_EXTENSIONS_QUERY, field: "mailTransport", eq: "smtp" },
      },
      {
        kind: "screen",
        id: "mail-smtp-secrets",
        screen: "mail-smtp-tenant-secrets",
        chromeless: true,
        visibleWhen: { query: SELECTED_EXTENSIONS_QUERY, field: "mailTransport", eq: "smtp" },
      },
    ]);
  });

  test("embedded screens are dormant and plugin features lose their tenant nav", () => {
    const schema = build(gatedFeatures());
    for (const id of [
      "mail-foundation-tenant-selection",
      "mail-smtp-tenant",
      "mail-inmemory-tenant",
    ]) {
      expect(screenOf(schema, id, "configEdit").dormant).toBe(true);
    }
    expect(screenOf(schema, "mail-smtp-tenant-secrets", "secretsEdit").dormant).toBe(true);
    expect(screenOf(schema, "mail-foundation-tenant", "dashboard").dormant).toBeUndefined();

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
  });

  test("plugin panel keeps title source: the plugin screen still uses its own settings section", () => {
    const schema = build(gatedFeatures());
    const pluginScreen: ConfigEditScreenDefinition = screenOf(
      schema,
      "mail-smtp-tenant",
      "configEdit",
    );
    expect(pluginScreen.configKeys).toEqual({ host: "mail-smtp:config:host" });
    expect(pluginScreen.layout.sections[0]).toMatchObject({ title: "mail-smtp.settings" });
  });

  test("plugin secrets panel reuses the global secrets access object", () => {
    const schema = build(gatedFeatures());
    const panelScreen: SecretsEditScreenDefinition = screenOf(
      schema,
      "mail-smtp-tenant-secrets",
      "secretsEdit",
    );
    const globalScreen = screenOf(schema, "secrets", "secretsEdit");
    expect(panelScreen.access).toBe(globalScreen.access);
    expect(panelScreen.requiredFields).toEqual(["mail-smtp-password"]);
    expect(Object.keys(panelScreen.secretKeys)).toEqual(["mail-smtp-password"]);
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
    const dashboard = screenOf(schema, "mail-foundation-tenant", "dashboard");
    expect(dashboard.panels.map((p) => p.id)).toEqual(["selection", "mail-inmemory-config"]);
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
  // Re-registers the GENERATED hub screens on the config stand-in so
  // validateBoot runs its real dashboard/screen-panel/query-ref checks on them.
  function hubHostFeature(withQuery: boolean): FeatureDefinition {
    const schema = build(gatedFeatures());
    // i18n coverage of the hub is asserted in the i18n-keys boot test; here every
    // required key is defined so only the screen/panel/query checks can fail.
    const translationKeys = Object.fromEntries(
      schema.screens
        .flatMap((s) =>
          requiredKeysFromScreen(SETTINGS_HUB_FEATURE, s, { treatDotFormAsKey: true }),
        )
        .map((key) => [key, { en: key }]),
    );
    return defineFeature("config", (r) => {
      r.translations({ keys: { ...translationKeys, ...SETTINGS_HUB_I18N } });
      if (withQuery) {
        r.queryHandler({
          name: "config-value:selected-extensions",
          schema: z.object({}),
          access: { openToAll: { reason: "test stand-in" } },
          handler: async () => ({}),
        });
      }
      for (const screen of schema.screens) r.screen(screen);
    });
  }

  test("panel targets resolve to embeddable generated screens and the visibleWhen query is registered", () => {
    expect(() => validateBoot([hubHostFeature(true), ...gatedFeatures()])).not.toThrow();
  });

  test("a visibleWhen query that is not a registered handler is rejected", () => {
    expect(() => validateBoot([hubHostFeature(false), ...gatedFeatures()])).toThrow(
      /visibleWhen query "config:query:config-value:selected-extensions"/,
    );
  });
});
