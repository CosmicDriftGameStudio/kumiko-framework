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
