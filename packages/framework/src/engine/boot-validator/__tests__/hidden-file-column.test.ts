import { describe, expect, test } from "bun:test";
import type {
  EditRelatedListSection,
  ListColumnSpec,
  RowAction,
} from "@cosmicdrift/kumiko-types/screen";
import { defineFeature } from "../../define-feature.ts";
import {
  createEntity,
  createFileField,
  createFilesField,
  createReferenceField,
  createTextField,
} from "../../factories.ts";
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

const filedDocumentEntity = createEntity({
  name: "filed-document",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    file: createFileField(),
  },
});

const bundleEntity = createEntity({
  name: "bundle",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    files: createFilesField(),
  },
});

const documentsFeature = defineFeature("documents", (r) => {
  r.entity(filedDocumentEntity);
  r.entity(bundleEntity);
});

const offerEntity = createEntity({
  name: "offer",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
    receipt: createReferenceField({
      entity: "documents:filed-document",
      labelField: "title",
      personal: false,
      reason: "test_fixture",
    }),
    receipts: createReferenceField({
      entity: "documents:filed-document",
      multiple: true,
      personal: false,
      reason: "test_fixture",
    }),
    bundle: createReferenceField({
      entity: "documents:bundle",
      personal: false,
      reason: "test_fixture",
    }),
    documentId: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

function offerWarnings(
  columns: readonly ListColumnSpec[],
  options: {
    readonly rowActions?: readonly RowAction[];
    readonly editScreenFields?: readonly string[];
  } = {},
): readonly BootWarning[] {
  const offerFeature = defineFeature("offers", (r) => {
    r.entity(offerEntity);
    r.screen({
      id: "offer-list",
      type: "entityList",
      entity: "offer",
      columns,
      ...(options.rowActions !== undefined && { rowActions: options.rowActions }),
    });
    if (options.editScreenFields !== undefined) {
      r.screen({
        id: "offer-edit",
        type: "entityEdit",
        entity: "offer",
        layout: { sections: [{ fields: [...options.editScreenFields] }] },
      });
    }
  });
  const warnings: BootWarning[] = [];
  warnOnUnreachableHiddenFileColumns((w) => warnings.push(w), [documentsFeature, offerFeature]);
  return warnings;
}

describe("warnOnUnreachableHiddenFileColumns on reference columns", () => {
  test("a hidden reference to an entity with one file field warns, its cell links that file", () => {
    const warnings = offerWarnings(["name", { field: "receipt", hideOnNarrow: true }]);
    expect(warnings).toEqual([
      expect.objectContaining({ kind: "list/hidden-file-column", feature: "offers" }),
    ]);
    expect(warnings[0]?.message).toContain("receipt");
  });

  test("a declared refEntity on a text column counts like a stored reference", () => {
    const warnings = offerWarnings([
      "name",
      { field: "documentId", refEntity: "documents:filed-document", hideOnNarrow: true },
    ]);
    expect(warnings).toHaveLength(1);
  });

  test("a row opener keeps the referenced file reachable", () => {
    expect(
      offerWarnings(["name", { field: "receipt", hideOnNarrow: true }], {
        rowActions: [{ kind: "navigate", id: "open", label: "Open", screen: "x", rowClick: true }],
      }),
    ).toEqual([]);
  });

  test("an edit screen showing the reference still warns, its form shows the picker, not the file", () => {
    const warnings = offerWarnings(["name", { field: "receipt", hideOnNarrow: true }], {
      editScreenFields: ["name", "receipt"],
    });
    expect(warnings).toHaveLength(1);
  });

  test("references whose cell shows text only never warn", () => {
    expect(
      offerWarnings([
        "name",
        { field: "receipts", hideOnNarrow: true },
        { field: "bundle", hideOnNarrow: true },
      ]),
    ).toEqual([]);
  });
});

function relatedListWarnings(
  screenType: "projectionDetail" | "entityEdit",
  section: Pick<EditRelatedListSection, "columns" | "entity" | "rowClick" | "rowActions">,
): readonly BootWarning[] {
  const detailFeature = defineFeature("offers", (r) => {
    r.entity(offerEntity);
    r.entity(
      createEntity({
        name: "job",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    const quotes: EditRelatedListSection = {
      id: "quotes",
      kind: "relatedList",
      title: "Quotes",
      query: "offers:query:offer:list",
      ...section,
    };
    if (screenType === "projectionDetail") {
      r.screen({
        id: "job-detail",
        type: "projectionDetail",
        query: "offers:query:job:get",
        layout: {
          mode: "tabs",
          sections: [{ id: "main", title: "Main", fields: ["name"] }, quotes],
        },
      });
    } else {
      r.screen({
        id: "job-edit",
        type: "entityEdit",
        entity: "job",
        layout: { sections: [{ fields: ["name"] }, quotes] },
      });
    }
  });
  const warnings: BootWarning[] = [];
  warnOnUnreachableHiddenFileColumns((w) => warnings.push(w), [documentsFeature, detailFeature]);
  return warnings;
}

describe("warnOnUnreachableHiddenFileColumns on relatedList sections", () => {
  const hiddenReceipt = ["name", { field: "receipt", hideOnNarrow: true }] as const;

  test.each(["projectionDetail", "entityEdit"] as const)(
    "a hidden reference column in a %s relatedList without a row opener warns",
    (type) => {
      const warnings = relatedListWarnings(type, {
        entity: "offers:offer",
        columns: hiddenReceipt,
      });
      expect(warnings).toEqual([
        expect.objectContaining({ kind: "list/hidden-file-column", feature: "offers" }),
      ]);
      expect(warnings[0]?.message).toContain('section "Quotes"');
      expect(warnings[0]?.message).toContain("receipt");
    },
  );

  test("a hidden file column of the section entity warns", () => {
    expect(
      relatedListWarnings("projectionDetail", {
        entity: "documents:filed-document",
        columns: ["title", { field: "file", hideOnNarrow: true }],
      }),
    ).toHaveLength(1);
  });

  test("a section rowClick or a rowClick action keeps the file reachable", () => {
    expect(
      relatedListWarnings("projectionDetail", {
        entity: "offers:offer",
        columns: hiddenReceipt,
        rowClick: { entity: "offers:offer" },
      }),
    ).toEqual([]);
    expect(
      relatedListWarnings("projectionDetail", {
        entity: "offers:offer",
        columns: hiddenReceipt,
        rowActions: [{ kind: "navigate", id: "open", label: "Open", screen: "x", rowClick: true }],
      }),
    ).toEqual([]);
  });
});
