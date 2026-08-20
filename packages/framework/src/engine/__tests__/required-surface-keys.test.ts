import { describe, expect, test } from "bun:test";
import {
  ACTION_FORM_ENTITY,
  CONFIG_EDIT_ENTITY,
  fieldLabelKey,
  requiredKeysFromNav,
  requiredKeysFromScreen,
  requiredKeysFromWorkspace,
  screenTitleKey,
} from "../../i18n/required-surface-keys";
import type {
  ConfigEditScreenDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "../types";

describe("requiredKeysFromScreen", () => {
  test("entityList emits screen title + column field labels", () => {
    const screen: EntityListScreenDefinition = {
      id: "component-list",
      type: "entityList",
      entity: "component",
      columns: ["name", { field: "status" }],
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain(screenTitleKey("component-list"));
    expect(keys).toContain(fieldLabelKey("publicstatus", "component", "name"));
    expect(keys).toContain(fieldLabelKey("publicstatus", "component", "status"));
  });

  test("actionForm uses ACTION_FORM_ENTITY namespace", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "incident-open-form",
      type: "actionForm",
      handler: "publicstatus:write:incident:open",
      fields: {
        title: { type: "text" },
      },
      layout: {
        sections: [{ fields: ["title"] }],
      },
    });
    expect(keys).toContain(fieldLabelKey("publicstatus", ACTION_FORM_ENTITY, "title"));
  });

  test("entityEdit emits submitLabel + section titles + field labels (override honored)", () => {
    const screen: EntityEditScreenDefinition = {
      id: "component-edit",
      type: "entityEdit",
      entity: "component",
      submitLabel: "publicstatus:actions.saveComponent",
      fieldLabels: { name: "publicstatus:override.name" },
      layout: {
        sections: [{ title: "publicstatus:section.basics", fields: ["name", "status"] }],
      },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:actions.saveComponent");
    expect(keys).toContain("publicstatus:section.basics");
    // override wins over the default entity:field convention
    expect(keys).toContain("publicstatus:override.name");
    expect(keys).not.toContain(fieldLabelKey("publicstatus", "component", "name"));
    expect(keys).toContain(fieldLabelKey("publicstatus", "component", "status"));
  });

  test("entityEdit extension section pushes only the section title (no field labels)", () => {
    const screen: EntityEditScreenDefinition = {
      id: "component-edit",
      type: "entityEdit",
      entity: "component",
      layout: {
        sections: [
          {
            kind: "extension",
            title: "publicstatus:section.customFields",
            component: { react: {} },
          },
        ],
      },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toEqual([screenTitleKey("component-edit"), "publicstatus:section.customFields"]);
  });

  test("configEdit uses the CONFIG_EDIT_ENTITY namespace, honors fieldLabels override", () => {
    const screen: ConfigEditScreenDefinition = {
      id: "settings-retention",
      type: "configEdit",
      scope: "tenant",
      configKeys: { days: "publicstatus:config:retentionDays" },
      fieldLabels: { days: "publicstatus:override.retentionDays" },
      fields: { days: { type: "number" } },
      layout: { sections: [{ fields: ["days"] }] },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:override.retentionDays");
    expect(keys).not.toContain(fieldLabelKey("publicstatus", CONFIG_EDIT_ENTITY, "days"));
  });

  test("configEdit without a fieldLabels override falls back to the CONFIG_EDIT_ENTITY convention", () => {
    const screen: ConfigEditScreenDefinition = {
      id: "settings-retention",
      type: "configEdit",
      scope: "tenant",
      configKeys: { days: "publicstatus:config:retentionDays" },
      fields: { days: { type: "number" } },
      layout: { sections: [{ fields: ["days"] }] },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain(fieldLabelKey("publicstatus", CONFIG_EDIT_ENTITY, "days"));
  });

  test("custom screen emits only the screen title — no field surface to validate", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "dashboard",
      type: "custom",
      renderer: { react: {} },
    });
    expect(keys).toEqual([screenTitleKey("dashboard")]);
  });

  test("entityList rowActions/toolbarActions emit label + confirm + confirmLabel", () => {
    const screen: EntityListScreenDefinition = {
      id: "component-list",
      type: "entityList",
      entity: "component",
      columns: ["name"],
      rowActions: [
        {
          id: "delete",
          label: "publicstatus:actions.delete",
          handler: "publicstatus:write:component:delete",
          confirm: "publicstatus:confirm.deleteComponent",
          confirmLabel: "publicstatus:confirm.deleteComponentButton",
          style: "danger",
        },
      ],
      toolbarActions: [
        {
          kind: "writeHandler",
          id: "sync-all",
          label: "publicstatus:actions.syncAll",
          handler: "publicstatus:write:component:syncAll",
          confirm: "publicstatus:confirm.syncAll",
          confirmLabel: "publicstatus:confirm.syncAllButton",
        },
      ],
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:actions.delete");
    expect(keys).toContain("publicstatus:confirm.deleteComponent");
    expect(keys).toContain("publicstatus:confirm.deleteComponentButton");
    expect(keys).toContain("publicstatus:actions.syncAll");
    expect(keys).toContain("publicstatus:confirm.syncAll");
    expect(keys).toContain("publicstatus:confirm.syncAllButton");
  });
});

describe("requiredKeysFromNav / requiredKeysFromWorkspace", () => {
  test("nav label is a required key", () => {
    expect(requiredKeysFromNav({ id: "catalog", label: "shop:nav.catalog" })).toEqual([
      "shop:nav.catalog",
    ]);
  });

  test("workspace label is a required key", () => {
    expect(
      requiredKeysFromWorkspace({ id: "disposition", label: "bmc:workspace.disposition" }),
    ).toEqual(["bmc:workspace.disposition"]);
  });
});

// fw#2260: isI18nKey's colon-only check silently drops dot-form labels like
// `${feature}.settings` — the Settings-Hub generator's own convention (see
// buildConfigFeatureSchema). requiredKeysFromScreen/requiredKeysFromNav take
// an opt-in `treatDotFormAsKey` option so the boot-validator can register
// those generated keys directly instead of relying on isI18nKey to recognize
// them.
describe("dot-form labels + treatDotFormAsKey (fw#2260)", () => {
  const configScreen: ConfigEditScreenDefinition = {
    id: "billing-tenant",
    type: "configEdit",
    scope: "tenant",
    configKeys: { apiKey: "billing:config:api-key" },
    fieldLabels: { apiKey: "billing.api-key" },
    fields: { apiKey: { type: "text" } },
    layout: { sections: [{ title: "billing.settings", fields: ["apiKey"] }] },
  };

  test("configEdit section title + fieldLabels override: dot-form is dropped by default", () => {
    const keys = requiredKeysFromScreen("config", configScreen);
    expect(keys).not.toContain("billing.settings");
    expect(keys).not.toContain("billing.api-key");
  });

  test("configEdit section title + fieldLabels override: treatDotFormAsKey surfaces the dot-form keys", () => {
    const keys = requiredKeysFromScreen("config", configScreen, { treatDotFormAsKey: true });
    expect(keys).toContain("billing.settings");
    expect(keys).toContain("billing.api-key");
  });

  test("colon-form keys are still required with treatDotFormAsKey (no regression for the normal path)", () => {
    const screen: ConfigEditScreenDefinition = {
      ...configScreen,
      fieldLabels: { apiKey: "billing:override.apiKey" },
      layout: { sections: [{ title: "billing:section.basics", fields: ["apiKey"] }] },
    };
    const keys = requiredKeysFromScreen("config", screen, { treatDotFormAsKey: true });
    expect(keys).toContain("billing:override.apiKey");
    expect(keys).toContain("billing:section.basics");
  });

  test("nav label: dot-form is dropped by default, treatDotFormAsKey surfaces it", () => {
    const nav = { id: "billing-tenant", label: "billing.settings" };
    expect(requiredKeysFromNav(nav)).not.toContain("billing.settings");
    expect(requiredKeysFromNav(nav, { treatDotFormAsKey: true })).toContain("billing.settings");
  });
});
