import { describe, expect, test } from "bun:test";
import {
  ACTION_FORM_ENTITY,
  fieldLabelKey,
  requiredKeysFromScreen,
  screenTitleKey,
} from "../../i18n/required-surface-keys";
import type { EntityListScreenDefinition } from "../types";

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
});
