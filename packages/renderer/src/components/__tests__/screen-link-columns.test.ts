import { describe, expect, test } from "bun:test";
import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { withScreenLinks } from "../use-render-list-columns.ts";

const screen: EntityListScreenDefinition = {
  id: "results",
  type: "entityList",
  entity: "result",
  columns: ["label", { field: "message", linkScreenField: "fixScreen" }],
};
const columns = [
  { field: "label", label: "Check", type: "text", sortable: false },
  { field: "message", label: "Result", type: "text", sortable: false },
];
const resolve = (screenQn: string) =>
  screenQn === "mail:screen:accounts" ? { href: "/accounts", onPress: () => {} } : undefined;

describe("withScreenLinks", () => {
  test("links the cell to the screen its row names, only where the row names one", () => {
    const [label, message] = withScreenLinks(columns, screen, resolve);

    expect(label?.linkFor).toBeUndefined();
    expect(message?.linkFor?.("x", { fixScreen: "mail:screen:accounts" })?.href).toBe("/accounts");
    expect(message?.linkFor?.("x", {})).toBeUndefined();
    expect(message?.linkFor?.("x", { fixScreen: "other:screen:denied" })).toBeUndefined();
  });
});
