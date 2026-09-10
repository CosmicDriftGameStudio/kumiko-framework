import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { synthesizeProjectionDetailScreen } from "../projection-detail-shim";

// Regression for the writeForm extension (fw editable-detail-screens): the
// hard readOnly:true enforcement in synthesizeProjectionDetailScreen must
// still apply to every ordinary fields-section, unchanged — a writeForm
// section is the one deliberate exception (isFieldsEditSection excludes it,
// same as relatedList/extension), it must pass through editable.
describe("synthesizeProjectionDetailScreen", () => {
  test("forces readOnly:true on a fields section, but leaves a writeForm section's own readOnly untouched", () => {
    const screen: ProjectionDetailScreenDefinition = {
      id: "order-detail",
      type: "projectionDetail",
      query: "orders:query:order:detail",
      layout: {
        sections: [
          { title: "Basics", fields: [{ field: "name", readOnly: false }] },
          {
            kind: "writeForm",
            title: "Add note",
            fieldDefs: { note: { type: "text" } },
            fields: [{ field: "note", readOnly: false }],
            handler: "orders:write:add-note",
          },
        ],
      },
    };

    const result = synthesizeProjectionDetailScreen(screen);

    const [fieldsSection, writeFormSection] = result.layout.sections;
    if (fieldsSection === undefined || !("fields" in fieldsSection) || "kind" in fieldsSection) {
      throw new Error("expected the first section to stay a plain fields section");
    }
    expect(fieldsSection.fields[0]).toMatchObject({ field: "name", readOnly: true });

    if (writeFormSection === undefined || writeFormSection.kind !== "writeForm") {
      throw new Error("expected the second section to stay kind: writeForm, untouched");
    }
    expect(writeFormSection.fields[0]).toEqual({ field: "note", readOnly: false });
  });

  test("carries description through so RenderEdit can render it as the form subtitle (fw#2723)", () => {
    const withDescription = synthesizeProjectionDetailScreen({
      id: "order-detail",
      type: "projectionDetail",
      description: "Read-only view of a placed order.",
      query: "orders:query:order:detail",
      layout: { sections: [{ title: "Basics", fields: ["name"] }] },
    });
    expect(withDescription.description).toBe("Read-only view of a placed order.");

    const withoutDescription = synthesizeProjectionDetailScreen({
      id: "order-detail",
      type: "projectionDetail",
      query: "orders:query:order:detail",
      layout: { sections: [{ title: "Basics", fields: ["name"] }] },
    });
    expect("description" in withoutDescription).toBe(false);
  });
});
