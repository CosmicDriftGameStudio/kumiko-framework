import { describe, expect, test } from "bun:test";
import {
  ACTION_FORM_ENTITY,
  CONFIG_EDIT_ENTITY,
  fieldLabelKey,
  PROJECTION_DETAIL_ENTITY,
  requiredKeysFromNav,
  requiredKeysFromScreen,
  requiredKeysFromWorkspace,
  screenTitleKey,
  WRITE_FORM_SECTION_ENTITY,
} from "../../i18n/required-surface-keys";
import { i18nKey } from "../i18n-key";
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

  test("actionForm honors a fieldLabels override, falls back to ACTION_FORM_ENTITY otherwise", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "reschedule-form",
      type: "actionForm",
      handler: "publicstatus:write:incident:reschedule",
      fields: { dueAt: { type: "date" }, note: { type: "text" } },
      fieldLabels: { dueAt: "publicstatus:override.dueAt" },
      layout: {
        sections: [{ fields: ["dueAt", "note"] }],
      },
    });
    expect(keys).toContain("publicstatus:override.dueAt");
    expect(keys).not.toContain(fieldLabelKey("publicstatus", ACTION_FORM_ENTITY, "dueAt"));
    expect(keys).toContain(fieldLabelKey("publicstatus", ACTION_FORM_ENTITY, "note"));
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

// fw#2313: a hand-written dot-form label ("sessions.list.col.id") is
// indistinguishable from literal display text ("actions.open") — isI18nKey
// only recognizes it once the author marks it explicitly via i18nKey().
describe("dot-form label opt-in (fw#2313)", () => {
  test("unmarked dot-form label is not required (regression guard for literal display text)", () => {
    const screen: EntityListScreenDefinition = {
      id: "fw2313-list",
      type: "entityList",
      entity: "widget",
      columns: ["name"],
      rowActions: [
        {
          id: "open",
          label: "actions.open",
          handler: "fw2313:write:widget:open",
        },
      ],
    };
    const keys = requiredKeysFromScreen("fw2313", screen);
    expect(keys).not.toContain("actions.open");
  });

  test("i18nKey()-marked dot-form label is required", () => {
    const screen: EntityListScreenDefinition = {
      id: "fw2313-list",
      type: "entityList",
      entity: "widget",
      columns: ["name"],
      rowActions: [
        {
          id: "open",
          label: i18nKey("fw2313.optin.col.alpha"),
          handler: "fw2313:write:widget:open",
        },
      ],
    };
    const keys = requiredKeysFromScreen("fw2313", screen);
    expect(keys).toContain("fw2313.optin.col.alpha");
  });

  test("i18nKey()-marked nav label is required", () => {
    const nav = { id: "fw2313-nav", label: i18nKey("fw2313.optin.nav.beta") };
    expect(requiredKeysFromNav(nav)).toContain("fw2313.optin.nav.beta");
  });
});

describe("requiredKeysFromScreen reads section.groups (fw#2986)", () => {
  test("entityEdit: group fields and group titles, override honored", () => {
    const screen: EntityEditScreenDefinition = {
      id: "component-edit",
      type: "entityEdit",
      entity: "component",
      fieldLabels: { name: "publicstatus:override.name" },
      layout: {
        sections: [
          {
            title: "publicstatus:section.basics",
            fields: [],
            groups: [
              { title: "publicstatus:group.identity", fields: ["name"] },
              { title: "publicstatus:group.state", fields: [{ field: "status" }] },
            ],
          },
        ],
      },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:section.basics");
    expect(keys).toContain("publicstatus:group.identity");
    expect(keys).toContain("publicstatus:group.state");
    expect(keys).toContain("publicstatus:override.name");
    expect(keys).not.toContain(fieldLabelKey("publicstatus", "component", "name"));
    expect(keys).toContain(fieldLabelKey("publicstatus", "component", "status"));
  });

  test("entityEdit: a section with fields AND groups yields the union of both", () => {
    const screen: EntityEditScreenDefinition = {
      id: "component-edit",
      type: "entityEdit",
      entity: "component",
      layout: {
        sections: [
          {
            fields: ["name"],
            groups: [{ title: "publicstatus:group.state", fields: ["status"] }],
          },
        ],
      },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain(fieldLabelKey("publicstatus", "component", "name"));
    expect(keys).toContain(fieldLabelKey("publicstatus", "component", "status"));
  });

  test("actionForm: group fields and group titles", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "incident-open-form",
      type: "actionForm",
      handler: "publicstatus:write:incident:open",
      fields: { title: { type: "text" }, note: { type: "text" } },
      fieldLabels: { title: "publicstatus:override.title" },
      layout: {
        sections: [
          {
            fields: [],
            groups: [{ title: "publicstatus:group.body", fields: ["title", "note"] }],
          },
        ],
      },
    });
    expect(keys).toContain("publicstatus:group.body");
    expect(keys).toContain("publicstatus:override.title");
    expect(keys).toContain(fieldLabelKey("publicstatus", ACTION_FORM_ENTITY, "note"));
  });

  test("secretMint: group fields and group titles in mint and confirm layout", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "token-mint",
      type: "secretMint",
      handler: "publicstatus:write:token:mint",
      fields: { label: { type: "text" } },
      layout: {
        sections: [
          {
            fields: [],
            groups: [{ title: "publicstatus:group.mint", fields: ["label"] }],
          },
        ],
      },
      reveal: { fields: [{ field: "token", label: "publicstatus:reveal.token" }] },
      confirm: {
        handler: "publicstatus:write:token:confirm",
        fields: { ack: { type: "boolean" } },
        layout: {
          sections: [
            {
              fields: [],
              groups: [{ title: "publicstatus:group.confirm", fields: ["ack"] }],
            },
          ],
        },
      },
    });
    expect(keys).toContain("publicstatus:group.mint");
    expect(keys).toContain(fieldLabelKey("publicstatus", ACTION_FORM_ENTITY, "label"));
    expect(keys).toContain("publicstatus:group.confirm");
    expect(keys).toContain(fieldLabelKey("publicstatus", ACTION_FORM_ENTITY, "ack"));
  });

  test("configEdit: group fields and group titles, override honored", () => {
    const screen: ConfigEditScreenDefinition = {
      id: "settings-retention",
      type: "configEdit",
      scope: "tenant",
      configKeys: {
        days: "publicstatus:config:retentionDays",
        mode: "publicstatus:config:mode",
      },
      fieldLabels: { days: "publicstatus:override.retentionDays" },
      fields: { days: { type: "number" }, mode: { type: "text" } },
      layout: {
        sections: [
          {
            fields: [],
            groups: [{ title: "publicstatus:group.retention", fields: ["days", "mode"] }],
          },
        ],
      },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:group.retention");
    expect(keys).toContain("publicstatus:override.retentionDays");
    expect(keys).toContain(fieldLabelKey("publicstatus", CONFIG_EDIT_ENTITY, "mode"));
  });

  test("configEdit: dot-form group titles need treatDotFormAsKey, like section titles", () => {
    const screen: ConfigEditScreenDefinition = {
      id: "settings-retention",
      type: "configEdit",
      scope: "tenant",
      configKeys: { days: "publicstatus:config:retentionDays" },
      fields: { days: { type: "number" } },
      layout: {
        sections: [
          {
            fields: [],
            groups: [{ title: "publicstatus.group.retention", fields: ["days"] }],
          },
        ],
      },
    };
    expect(requiredKeysFromScreen("publicstatus", screen)).not.toContain(
      "publicstatus.group.retention",
    );
    expect(requiredKeysFromScreen("publicstatus", screen, { treatDotFormAsKey: true })).toContain(
      "publicstatus.group.retention",
    );
  });

  test("projectionDetail: group fields and group titles, override honored", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "incident-detail",
      type: "projectionDetail",
      query: "publicstatus:query:incident:detail",
      fieldLabels: { severity: "publicstatus:override.severity" },
      layout: {
        sections: [
          {
            fields: [],
            groups: [{ title: "publicstatus:group.facts", fields: ["severity", "openedAt"] }],
          },
        ],
      },
    });
    expect(keys).toContain("publicstatus:group.facts");
    expect(keys).toContain("publicstatus:override.severity");
    expect(keys).toContain(fieldLabelKey("publicstatus", PROJECTION_DETAIL_ENTITY, "openedAt"));
  });

  test("projectionDetail: writeForm sections keep the WRITE_FORM_SECTION_ENTITY namespace", () => {
    const keys = requiredKeysFromScreen("publicstatus", {
      id: "incident-detail",
      type: "projectionDetail",
      query: "publicstatus:query:incident:detail",
      layout: {
        sections: [
          {
            kind: "writeForm",
            title: "publicstatus:section.comment",
            handler: "publicstatus:write:incident:comment",
            fieldDefs: { body: { type: "text" } },
            fields: ["body"],
          },
        ],
      },
    });
    expect(keys).toContain(fieldLabelKey("publicstatus", WRITE_FORM_SECTION_ENTITY, "body"));
  });
});
