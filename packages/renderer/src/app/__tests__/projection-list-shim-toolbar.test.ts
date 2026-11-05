import { describe, expect, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { synthesizeProjectionScreen } from "../projection-list-shim.ts";

const base: ProjectionListScreenDefinition = {
  id: "contracts",
  type: "projectionList",
  query: "shop:query:contract:rows",
  columns: ["name"],
};

describe("synthesizeProjectionScreen toolbar options", () => {
  test("passes toolbarSort and toolbarActionsPlacement to the list screen", () => {
    const synthesized = synthesizeProjectionScreen({
      ...base,
      toolbarSort: true,
      toolbarActionsPlacement: "toolbar",
    });
    expect(synthesized.toolbarSort).toBe(true);
    expect(synthesized.toolbarActionsPlacement).toBe("toolbar");
  });

  test("leaves both unset by default", () => {
    const synthesized = synthesizeProjectionScreen(base);
    expect(synthesized.toolbarSort).toBeUndefined();
    expect(synthesized.toolbarActionsPlacement).toBeUndefined();
  });
});
