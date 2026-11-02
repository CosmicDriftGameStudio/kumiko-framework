import { describe, expect, test } from "bun:test";
import type { ListColumnSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { createDocumentListScreen } from "../screens.ts";
import { documentsTab } from "../tab.ts";

function rendererOf(columns: readonly ListColumnSpec[], field: string): unknown {
  for (const column of columns) {
    if (typeof column !== "string" && column.field === field) return column.renderer;
  }
  return undefined;
}

describe("documents file column", () => {
  test("the list screen offers the PDF viewer on the file column", () => {
    const screen = createDocumentListScreen({ roles: ["TenantAdmin"] }, ["contract"]);
    expect(rendererOf(screen.columns, "file")).toEqual({ format: "file", viewInDrawer: true });
  });

  test("the record tab offers the PDF viewer on the file column", () => {
    expect(rendererOf(documentsTab("property").columns, "file")).toEqual({
      format: "file",
      viewInDrawer: true,
    });
  });
});
