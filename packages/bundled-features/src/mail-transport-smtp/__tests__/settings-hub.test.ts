// Tenant admins edit their own SMTP server in the generated Settings-Hub: provider
// select, SMTP connection keys and the password secret on one dashboard, with every
// label translated. No platform-scope screen: a platform-level provider would be
// inherited by every tenant without that tenant's password.

import { describe, expect, test } from "bun:test";
import {
  buildConfigFeatureSchema,
  createRegistry,
  defineFeature,
  type ScreenDefinition,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { translationValueOtherText } from "@cosmicdrift/kumiko-framework/ui-types";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { createConfigFeature } from "../../config/feature.js";
import { mailFoundationFeature } from "../../mail-foundation/feature.js";
import { mailTransportInMemoryFeature } from "../../mail-transport-inmemory/index.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { mailTransportSmtpFeature } from "../feature.js";

function features() {
  return [
    createConfigFeature(),
    createSecretsFeature(),
    mailFoundationFeature,
    mailTransportSmtpFeature,
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

function sectionText(screen: ScreenDefinition): { title?: string; description?: string } {
  if (screen.type !== "configEdit") return {};
  const section = screen.layout.sections[0];
  if (section === undefined || !("fields" in section)) return {};
  return {
    ...(section.title !== undefined && { title: section.title }),
    ...(section.description !== undefined && { description: section.description }),
  };
}

describe("mail transport settings for tenant admins", () => {
  test("boots with the generated screens and their translations", () => {
    expect(() => validateBoot(features())).not.toThrow();
  });

  test("one tenant dashboard: provider select, SMTP connection, SMTP password", () => {
    const built = schema();
    const dashboard = screenOf(built, "mail-foundation-tenant", "dashboard");
    expect(dashboard.panels.map((panel) => panel.id)).toEqual([
      "selection",
      "mail-transport-smtp-config",
      "mail-transport-smtp-secrets",
    ]);
    expect(dashboard.access).toEqual({ roles: ["TenantAdmin"] });

    const selection = screenOf(built, "mail-foundation-tenant-selection", "configEdit");
    expect(selection.fields["provider"]).toMatchObject({ type: "select", options: ["smtp"] });

    const smtp = screenOf(built, "mail-transport-smtp-tenant", "configEdit");
    expect(Object.values(smtp.configKeys)).toEqual([
      "mail-transport-smtp:config:host",
      "mail-transport-smtp:config:port",
      "mail-transport-smtp:config:secure",
      "mail-transport-smtp:config:auth-user",
      "mail-transport-smtp:config:from",
    ]);
    const secrets = screenOf(built, "mail-transport-smtp-tenant-secrets", "secretsEdit");
    expect(secrets.sections?.map((section) => section.title)).toEqual([
      "mail-transport-smtp.settings.secrets",
    ]);
    expect(Object.values(secrets.secretKeys)).toEqual(["mail-transport-smtp:secret:smtp-password"]);
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
    const built = buildConfigFeatureSchema(
      createRegistry([germanOnly, ...features(), mailTransportInMemoryFeature]),
    );
    const optionKey = "config:entity:__config-edit__:field:provider:option:";
    expect(built.translations?.[`${optionKey}smtp`]).toEqual({
      en: "SMTP server",
      de: "SMTP-Server",
    });
    expect(built.translations?.[`${optionKey}inmemory`]).toEqual({ en: "Test inbox (in memory)" });
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

    const selection = screenOf(built, "mail-foundation-tenant-selection", "configEdit");
    const smtp = screenOf(built, "mail-transport-smtp-tenant", "configEdit");
    const nav = built.navs.find((n) => n.id === "mail-foundation-tenant");
    const smtpSection = sectionText(smtp);
    const ownKeys = [
      nav?.label,
      "screen:mail-foundation-tenant.title",
      ...Object.values(selection.fieldLabels ?? {}),
      "mail-foundation.provider.description",
      smtpSection.title,
      smtpSection.description,
      ...Object.values(smtp.fieldLabels ?? {}),
      ...Object.values(smtp.configKeys).map((qn) => registry.getConfigKey(qn)?.mask?.description),
      "mail-transport-smtp.settings.secrets",
      "config.secret.mail-transport-smtp.smtp-password.label",
      "config.secret.mail-transport-smtp.smtp-password.hint",
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
