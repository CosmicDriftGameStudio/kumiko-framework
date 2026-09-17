import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  synthesizeProjectionDetailEntity,
  synthesizeProjectionDetailScreen,
} from "../projection-detail-shim";

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

// Regression for fw#2982: a section that puts its fields in `groups`
// instead of `fields` used to vanish entirely — synthesizeProjectionDetailEntity
// never registered the field names, so computeEditViewModel threw "references
// unknown field" for every one of them, and synthesizeProjectionDetailScreen
// let a group field's own readOnly value pass through unforced.
describe("groups-sections (fw#2982)", () => {
  const groupsOnlyScreen: ProjectionDetailScreenDefinition = {
    id: "contact-detail",
    type: "projectionDetail",
    query: "contacts:query:contact:detail",
    layout: {
      sections: [
        {
          title: "Stammdaten",
          fields: [],
          groups: [
            {
              title: "Kontakt",
              fields: [{ field: "contactKind", readOnly: false }, "email"],
            },
          ],
        },
      ],
    },
  };

  test("synthesizeProjectionDetailEntity registers every field declared only through groups", () => {
    const entity = synthesizeProjectionDetailEntity(groupsOnlyScreen.layout);
    expect(entity.fields["contactKind"]).toEqual({ type: "text" });
    expect(entity.fields["email"]).toEqual({ type: "text" });
  });

  test("synthesizeProjectionDetailScreen forces readOnly:true on a group field even when the author set readOnly:false", () => {
    const result = synthesizeProjectionDetailScreen(groupsOnlyScreen);
    const [section] = result.layout.sections;
    if (section === undefined || !("fields" in section) || "kind" in section) {
      throw new Error("expected the section to stay a plain fields section");
    }
    if (!("groups" in section) || section.groups === undefined) {
      throw new Error("expected the section to keep its groups");
    }
    expect(section.groups[0]?.fields).toEqual([
      { field: "contactKind", readOnly: true },
      { field: "email", readOnly: true },
    ]);
  });

  test("a screen mixing a plain fields section and a groups section resolves both, for both functions", () => {
    const mixedScreen: ProjectionDetailScreenDefinition = {
      id: "deposit-detail",
      type: "projectionDetail",
      query: "deposits:query:deposit:detail",
      layout: {
        sections: [
          { title: "Basics", fields: [{ field: "amount", readOnly: false }] },
          {
            title: "Parties",
            fields: [],
            groups: [{ title: "Tenant", fields: ["tenantName"] }],
          },
        ],
      },
    };

    const entity = synthesizeProjectionDetailEntity(mixedScreen.layout);
    expect(entity.fields["amount"]).toEqual({ type: "text" });
    expect(entity.fields["tenantName"]).toEqual({ type: "text" });

    const result = synthesizeProjectionDetailScreen(mixedScreen);
    const [fieldsSection, groupsSection] = result.layout.sections;
    if (fieldsSection === undefined || !("fields" in fieldsSection) || "kind" in fieldsSection) {
      throw new Error("expected the first section to stay a plain fields section");
    }
    expect(fieldsSection.fields[0]).toMatchObject({ field: "amount", readOnly: true });

    if (
      groupsSection === undefined ||
      !("groups" in groupsSection) ||
      groupsSection.groups === undefined
    ) {
      throw new Error("expected the second section to keep its groups");
    }
    expect(groupsSection.groups[0]?.fields).toEqual([{ field: "tenantName", readOnly: true }]);
  });

  // The boot-validator rejects fields+groups both non-empty on one section at
  // boot time, so an author can never actually ship this shape — but the shim
  // is not itself a validation pass, and this pins the union, not the
  // either/or a naive `groups !== undefined ? grouped : fields` would take.
  test("a single section carrying both fields and groups resolves both, for both functions", () => {
    const bothScreen: ProjectionDetailScreenDefinition = {
      id: "invoice-detail",
      type: "projectionDetail",
      query: "invoices:query:invoice:detail",
      layout: {
        sections: [
          {
            title: "Mixed",
            fields: [{ field: "amount", readOnly: false }],
            groups: [{ title: "Tenant", fields: ["tenantName"] }],
          },
        ],
      },
    };

    const entity = synthesizeProjectionDetailEntity(bothScreen.layout);
    expect(entity.fields["amount"]).toEqual({ type: "text" });
    expect(entity.fields["tenantName"]).toEqual({ type: "text" });

    const result = synthesizeProjectionDetailScreen(bothScreen);
    const [section] = result.layout.sections;
    if (section === undefined || !("fields" in section) || "kind" in section) {
      throw new Error("expected the section to stay a plain fields section");
    }
    expect(section.fields[0]).toMatchObject({ field: "amount", readOnly: true });

    if (!("groups" in section) || section.groups === undefined) {
      throw new Error("expected the section to keep its groups");
    }
    expect(section.groups[0]?.fields).toEqual([{ field: "tenantName", readOnly: true }]);
  });
});
