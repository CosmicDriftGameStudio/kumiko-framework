// Tenant admins edit their own SMTP server in the generated Settings-Hub: provider
// select, SMTP connection keys and the password secret in one form with one save, with every
// label translated. No platform-scope screen: a platform-level provider would be
// inherited by every tenant without that tenant's password.

import { describe, expect, test } from "bun:test";
import {
  buildConfigFeatureSchema,
  createRegistry,
  defineFeature,
  type ScreenDefinition,
  selectablePluginIds,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { translationValueOtherText } from "@cosmicdrift/kumiko-framework/ui-types";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { createConfigFeature } from "../../config/feature.js";
import {
  createMailFoundationFeature,
  MAIL_TRANSPORT_EXTENSION,
} from "../../mail-foundation/feature.js";
import { createMailTransportInMemoryFeature } from "../../mail-transport-inmemory/index.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { createMailTransportSmtpFeature } from "../feature.js";

function features() {
  return [
    createConfigFeature(),
    createSecretsFeature(),
    createMailFoundationFeature(),
    createMailTransportSmtpFeature(),
  ];
}

function schema() {
  return buildConfigFeatureSchema(createRegistry(features()));
}

function screenOf<T extends ScreenDefinition["type"]>(
  built: ReturnType<typeof buildConfigFeatureSchema>,
  id: string,
  type: T,
): Extract<ScreenDefinition, { type: T }> {
  const found = built.screens.find((s) => s.id === id);
  if (found === undefined || found.type !== type) throw new Error(`no ${type} screen "${id}"`);
  return found as Extract<ScreenDefinition, { type: T }>; // @cast-boundary type checked on the line above
}

function sectionTexts(screen: ScreenDefinition): (string | undefined)[] {
  if (screen.type !== "configEdit") return [];
  return screen.layout.sections.flatMap((section) =>
    "fields" in section ? [section.title, section.description] : [],
  );
}

describe("mail transport settings for tenant admins", () => {
  test("boots with the generated screens and their translations", () => {
    expect(() => validateBoot(features())).not.toThrow();
  });

  test("one form saves the provider, the SMTP connection and the SMTP password", () => {
    const built = schema();
    const dashboard = screenOf(built, "mail-foundation-tenant", "dashboard");
    expect(dashboard.panels.map((panel) => panel.id)).toEqual(["selection"]);
    expect(dashboard.access).toEqual({ roles: ["TenantAdmin"] });
    expect(built.screens.map((s) => s.id)).not.toContain("mail-transport-smtp-tenant");
    expect(built.screens.map((s) => s.id)).not.toContain("mail-transport-smtp-tenant-secrets");

    const form = screenOf(built, "mail-foundation-tenant-selection", "configEdit");
    expect(form.fields["provider"]).toMatchObject({ type: "select", options: ["smtp"] });
    expect(Object.values(form.configKeys)).toEqual([
      "mail-foundation:config:provider",
      "mail-transport-smtp:config:host",
      "mail-transport-smtp:config:port",
      "mail-transport-smtp:config:secure",
      "mail-transport-smtp:config:auth-user",
      "mail-transport-smtp:config:from",
    ]);
    expect(form.secretKeys).toEqual({
      "mail-transport-smtp-smtp-password": "mail-transport-smtp:secret:smtp-password",
    });
    expect(form.fields["mail-transport-smtp-smtp-password"]).toMatchObject({
      type: "text",
      writeOnly: true,
    });
    expect(
      form.layout.sections.map((section) => ("title" in section ? section.title : "")),
    ).toEqual([
      "config.settings.provider",
      "mail-transport-smtp.settings",
      "mail-transport-smtp.settings.secrets",
    ]);
    expect(form.submitLabel).toBeUndefined();
  });

  test("no platform screen for the provider or the SMTP keys", () => {
    const ids = schema().screens.map((s) => s.id);
    expect(ids).not.toContain("mail-foundation-system");
    expect(ids).not.toContain("mail-transport-smtp-system");
  });

  test("the provider can be left empty without a readiness gap", () => {
    const provider = createRegistry(features()).getConfigKey("mail-foundation:config:provider");
    expect(provider?.required).toBeUndefined();
  });

  test("provider options show the plugins' names, also with a locale feature mounted first", () => {
    const germanOnly = defineFeature("locale-test", (r) => {
      r.translations({ keys: { "mail-transport-smtp.settings": { de: "SMTP-Server" } } });
    });
    const built = buildConfigFeatureSchema(createRegistry([germanOnly, ...features()]));
    const optionKey = "config:entity:__config-edit__:field:provider:option:";
    expect(built.translations?.[`${optionKey}smtp`]).toEqual({
      en: "SMTP server",
      de: "SMTP-Server",
    });
  });

  test("the in-memory test inbox is never offered, but stays a valid stored provider", () => {
    const registry = createRegistry([...features(), createMailTransportInMemoryFeature()]);
    const built = buildConfigFeatureSchema(registry);
    const form = screenOf(built, "mail-foundation-tenant-selection", "configEdit");
    expect(form.fields["provider"]).toMatchObject({ type: "select", options: ["smtp"] });
    expect(
      built.translations?.["config:entity:__config-edit__:field:provider:option:inmemory"],
    ).toBeUndefined();
    expect(selectablePluginIds(registry, MAIL_TRANSPORT_EXTENSION)).toEqual(["inmemory", "smtp"]);
  });

  test("every visible label resolves in en, de and es", () => {
    const built = schema();
    const registry = createRegistry(features());
    const en = new Map<string, string>();
    for (const feature of registry.features.values()) {
      for (const [key, value] of Object.entries(feature.translations ?? {})) {
        const text = value["en"];
        if (text !== undefined) en.set(key, translationValueOtherText(text));
      }
    }
    for (const [key, value] of Object.entries(built.translations ?? {})) {
      const text = value["en"];
      if (text !== undefined) en.set(key, translationValueOtherText(text));
    }

    const form = screenOf(built, "mail-foundation-tenant-selection", "configEdit");
    const nav = built.navs.find((n) => n.id === "mail-foundation-tenant");
    const ownKeys = [
      nav?.label,
      "screen:mail-foundation-tenant.title",
      ...sectionTexts(form),
      ...Object.values(form.fieldLabels ?? {}),
      ...Object.values(form.fieldDescriptions ?? {}),
    ];
    for (const key of ownKeys) {
      if (key === undefined) throw new Error("missing label key");
      const english = en.get(key);
      expect(english, `en:${key}`).toBeString();
      for (const [locale, bundle] of [
        ["de", localeDeBundle],
        ["es", localeEsBundle],
      ] as const) {
        const text = bundle[key];
        expect(text, `${locale}:${key}`).toBeString();
        expect(text, `${locale}:${key}`).not.toBe(english);
      }
    }
  });
});
