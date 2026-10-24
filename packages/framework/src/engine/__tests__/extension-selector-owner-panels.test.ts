import { describe, expect, test } from "bun:test";
import type { ExtensionSelectorPanel } from "@cosmicdrift/kumiko-types/config";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import { SETTINGS_HUB_I18N } from "../../i18n/settings-hub-keys.ts";
import { validateBoot } from "../boot-validator.ts";
import { buildAppSchema } from "../build-app-schema.ts";
import { buildConfigFeatureSchema } from "../build-config-feature-schema.ts";
import { access, createTenantConfig } from "../config-helpers.ts";
import { defineFeature } from "../define-feature.ts";
import { projectAppSchemaForRoles } from "../project-app-schema-for-roles.ts";
import { createRegistry } from "../registry.ts";
import type { FeatureDefinition } from "../types/index.ts";

const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const STATUS_PANEL: ExtensionSelectorPanel = {
  kind: "custom",
  id: "mail-status",
  component: { react: { __component: "mail-foundation-status" } },
};
const QUEUE_PANEL: ExtensionSelectorPanel = {
  kind: "screen",
  id: "queue",
  screen: "queue",
  visibleWhen: { query: "mail-foundation:query:queue:status", field: "enabled", eq: true },
};

function mailFoundation(panels: readonly ExtensionSelectorPanel[], withStatusQuery = true) {
  return defineFeature("mail-foundation", (r) => {
    r.translations({
      keys: {
        "screen:queue.title": { en: "Queue" },
        "screen:queue-hint.title": { en: "Queue hint" },
        "mail.provider": { en: "Provider" },
        "mail-foundation.settings": { en: "Mail" },
      },
    });
    r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
    r.queryHandler({
      name: "queue:list",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN,
    });
    if (withStatusQuery) {
      r.queryHandler({
        name: "queue:status",
        schema: z.object({}),
        handler: async () => ({ enabled: true }),
        access: OPEN,
      });
    }
    r.screen({
      id: "queue",
      type: "projectionList",
      dormant: true,
      query: "mail-foundation:query:queue:list",
      columns: ["name"],
    });
    r.screen({
      id: "queue-hint",
      type: "projectionList",
      dormant: true,
      query: "mail-foundation:query:queue:list",
      columns: ["name"],
    });
    const keys = r.config({
      keys: {
        provider: createTenantConfig("text", {
          default: "",
          write: access.roles("TenantAdmin", "Admin"),
          mask: { title: "mail.provider", order: 1, icon: "mail" },
        }),
      },
    });
    r.extensionSelector("mailTransport", keys.provider, { panels });
  });
}

const configHub = defineFeature("config", (r) => {
  r.translations({
    keys: {
      ...SETTINGS_HUB_I18N,
      "screen:mail-foundation-tenant.title": { en: "Mail" },
    },
  });
});

function validateBootWithHub(owner: FeatureDefinition): void {
  validateBoot([configHub, owner]);
}

const smtp = defineFeature("mail-smtp", (r) => {
  r.requires({ features: ["mail-foundation"] });
  r.useExtension("mailTransport", "smtp");
  r.config({
    keys: {
      host: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "Admin"),
        mask: { title: "smtp.host" },
      }),
    },
  });
});

function ownerDashboard(features: Parameters<typeof createRegistry>[0]): DashboardScreenDefinition {
  const schema = buildConfigFeatureSchema(createRegistry(features));
  const dashboard = schema.screens.find((s) => s.id === "mail-foundation-tenant");
  if (dashboard?.type !== "dashboard") throw new Error("owner dashboard missing");
  return dashboard;
}

describe("extensionSelector owner panels — generated dashboard", () => {
  test("owner panels sit after the provider form, short screen refs are qualified", () => {
    const dashboard = ownerDashboard([mailFoundation([STATUS_PANEL, QUEUE_PANEL]), smtp]);
    expect(dashboard.panels.map((p) => p.id)).toEqual(["selection", "mail-status", "queue"]);
    expect(dashboard.panels[2]).toMatchObject({
      kind: "screen",
      screen: "mail-foundation:screen:queue",
    });
  });

  test("a short fallback ref is qualified like the screen ref and passes boot validation", () => {
    const owner = mailFoundation([{ ...QUEUE_PANEL, fallback: "queue-hint" }]);
    const dashboard = ownerDashboard([owner, smtp]);
    expect(dashboard.panels[1]).toMatchObject({
      kind: "screen",
      fallback: "mail-foundation:screen:queue-hint",
    });
    expect(() => validateBootWithHub(owner)).not.toThrow();
  });

  test("a selector with panels but no gated plugin still renders as a dashboard", () => {
    const dashboard = ownerDashboard([mailFoundation([STATUS_PANEL])]);
    expect(dashboard.panels.map((p) => p.id)).toEqual(["selection", "mail-status"]);
  });

  test("two selectors of one owner declaring the same panel id throw", () => {
    const smsSelector = defineFeature("mail-foundation", (r) => {
      r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
      r.extendsRegistrar("smsTransport", { onRegister: () => undefined });
      const keys = r.config({
        keys: {
          provider: createTenantConfig("text", {
            default: "",
            write: access.roles("TenantAdmin", "Admin"),
            mask: { title: "mail.provider" },
          }),
          "sms-provider": createTenantConfig("text", {
            default: "",
            write: access.roles("TenantAdmin", "Admin"),
            mask: { title: "sms.provider" },
          }),
        },
      });
      r.extensionSelector("mailTransport", keys.provider, { panels: [STATUS_PANEL] });
      r.extensionSelector("smsTransport", keys["sms-provider"], { panels: [STATUS_PANEL] });
    });
    expect(() => ownerDashboard([smsSelector])).toThrow(/duplicate panel id "mail-status"/);
  });

  test("an untyped author passing another panel kind fails closed", () => {
    const stat = { kind: "stat", id: "x", label: "x", query: "q", valueField: "v" };
    expect(() =>
      // @ts-expect-error stat panels are excluded by type; this simulates an untyped author
      mailFoundation([stat]),
    ).toThrow(/unsupported kind/);
  });

  test("TenantAdmin's projected schema carries the owner panels on config:screen:<owner>-tenant", () => {
    const app = buildAppSchema(createRegistry([mailFoundation([STATUS_PANEL, QUEUE_PANEL]), smtp]));
    const projected = projectAppSchemaForRoles(app, ["TenantAdmin"]);
    const config = projected.features.find((f) => f.featureName === "config");
    const dashboard = config?.screens.find((s) => s.id === "mail-foundation-tenant");
    if (dashboard?.type !== "dashboard") throw new Error("owner dashboard missing");
    expect(dashboard.panels.map((p) => p.id)).toEqual(["selection", "mail-status", "queue"]);
  });
});

describe("extensionSelector owner panels — boot validation", () => {
  test("valid custom + screen panels boot", () => {
    expect(() => validateBootWithHub(mailFoundation([STATUS_PANEL, QUEUE_PANEL]))).not.toThrow();
  });

  test("a screen ref that resolves to no registered screen throws", () => {
    const dead: ExtensionSelectorPanel = { kind: "screen", id: "ghost", screen: "ghost" };
    expect(() => validateBootWithHub(mailFoundation([dead]))).toThrow(
      /extensionSelector\("mailTransport"\)" \(dashboard\) screen-panel "ghost" screen "mail-foundation:screen:ghost" does not resolve/,
    );
  });

  test("a visibleWhen query that is no registered handler throws", () => {
    expect(() => validateBootWithHub(mailFoundation([QUEUE_PANEL], false))).toThrow(
      /panel "queue" visibleWhen query "mail-foundation:query:queue:status"/,
    );
  });

  test("a screen panel with a label throws at declaration", () => {
    const labeled = { ...QUEUE_PANEL, label: "mail:queue" };
    expect(() => mailFoundation([labeled])).toThrow(/must not set a label/);
  });

  test("the reserved selection id, duplicate ids and empty ids throw at declaration", () => {
    for (const panels of [
      [{ ...STATUS_PANEL, id: "selection" }],
      [STATUS_PANEL, STATUS_PANEL],
      [{ ...STATUS_PANEL, id: "" }],
    ]) {
      expect(() => mailFoundation(panels)).toThrow(/must be unique, non-empty and not "selection"/);
    }
  });
});
