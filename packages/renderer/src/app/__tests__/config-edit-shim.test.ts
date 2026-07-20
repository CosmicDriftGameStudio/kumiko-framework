import { describe, expect, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { synthesizeConfigEditEntity, synthesizeConfigEditScreen } from "../config-edit-shim";

describe("synthesizeConfigEditEntity", () => {
  test("wraps the inline fields as an EntityDefinition", () => {
    const fields = { apiKey: { type: "text" } } as unknown as ConfigEditScreenDefinition["fields"];
    expect(synthesizeConfigEditEntity(fields)).toEqual({ fields });
  });
});

describe("synthesizeConfigEditScreen", () => {
  test("stamps type: entityEdit and a pseudo entity name", () => {
    const screen = {
      id: "settings",
      layout: { sections: [] },
    } as unknown as ConfigEditScreenDefinition;

    const result = synthesizeConfigEditScreen(screen);
    expect(result.id).toBe("settings");
    expect(result.type).toBe("entityEdit");
    expect(result.entity).toBe("__config-edit__");
    expect(result.layout).toBe(screen.layout);
    expect(result).not.toHaveProperty("fieldLabels");
    expect(result).not.toHaveProperty("access");
  });

  test("carries fieldLabels and access through when present", () => {
    const screen = {
      id: "settings",
      layout: { sections: [] },
      fieldLabels: { apiKey: "config.apiKey" },
      access: { roles: ["Admin"] },
    } as unknown as ConfigEditScreenDefinition;

    const result = synthesizeConfigEditScreen(screen);
    expect(result.fieldLabels).toEqual({ apiKey: "config.apiKey" });
    expect(result.access).toEqual({ roles: ["Admin"] });
  });
});
