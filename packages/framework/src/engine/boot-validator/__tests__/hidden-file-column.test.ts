import { describe, expect, test } from "bun:test";
import type { ListColumnSpec, RowAction } from "@cosmicdrift/kumiko-types/screen";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createFileField, createTextField } from "../../factories.ts";
import type { BootWarning } from "../boot-warning.ts";
import { warnOnUnreachableHiddenFileColumns } from "../card-meta-overflow.ts";

const entity = createEntity({
  name: "statement",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
    report: createFileField(),
    receiptId: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

function statementFeature(
  columns: readonly ListColumnSpec[],
  options: {
    readonly rowActions?: readonly RowAction[];
    readonly editScreenFields?: readonly string[];
  } = {},
) {
  return defineFeature("statements", (r) => {
    r.entity(entity);
    r.screen({
      id: "statement-list",
      type: "entityList",
      entity: "statement",
      columns,
      ...(options.rowActions !== undefined && { rowActions: options.rowActions }),
    });
    if (options.editScreenFields !== undefined) {
      r.screen({
        id: "statement-edit",
        type: "entityEdit",
        entity: "statement",
        layout: { sections: [{ fields: [...options.editScreenFields] }] },
      });
    }
  });
}

function warningsFor(feature: ReturnType<typeof statementFeature>): readonly BootWarning[] {
  const warnings: BootWarning[] = [];
  warnOnUnreachableHiddenFileColumns((w) => warnings.push(w), [feature]);
  return warnings;
}

describe("warnOnUnreachableHiddenFileColumns", () => {
  test("a file column hidden on narrow without a row opener or detail screen warns", () => {
    const warnings = warningsFor(
      statementFeature(["name", { field: "report", hideOnNarrow: true }]),
    );
    expect(warnings).toEqual([
      expect.objectContaining({ kind: "list/hidden-file-column", feature: "statements" }),
    ]);
    expect(warnings[0]?.message).toContain('"statement-list"');
    expect(warnings[0]?.message).toContain("report");
  });

  test("the message names the app-wide onRowClick, which the boot check cannot see", () => {
    const warnings = warningsFor(
      statementFeature(["name", { field: "report", hideOnNarrow: true }]),
    );
    expect(warnings[0]?.message).toContain("onRowClick");
  });

  test("an edit screen that does not show the file field still warns", () => {
    const warnings = warningsFor(
      statementFeature(["name", { field: "report", hideOnNarrow: true }], {
        editScreenFields: ["name"],
      }),
    );
    expect(warnings).toHaveLength(1);
  });

  test("a FormatSpec file column counts like a file field", () => {
    const warnings = warningsFor(
      statementFeature([
        "name",
        { field: "receiptId", renderer: { format: "file" }, hideOnNarrow: true },
      ]),
    );
    expect(warnings).toHaveLength(1);
  });

  test("a visible file column, a rowClick action or an edit screen keeps the file reachable", () => {
    const hidden = { field: "report", hideOnNarrow: true } as const;
    expect(warningsFor(statementFeature(["name", "report"]))).toEqual([]);
    expect(
      warningsFor(
        statementFeature(["name", hidden], {
          rowActions: [
            { kind: "navigate", id: "open", label: "Open", screen: "x", rowClick: true },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      warningsFor(statementFeature(["name", hidden], { editScreenFields: ["name", "report"] })),
    ).toEqual([]);
  });
});
