import { describe, expect, test } from "bun:test";
import type {
  EditFieldSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { createFormController } from "@cosmicdrift/kumiko-headless";
import { buildFormSchema, REQUIRED_FIELD_I18N_KEY } from "../form-schema";

function screenWith(fields: readonly EditFieldSpec[]): EntityEditScreenDefinition {
  return {
    id: "s",
    type: "entityEdit",
    entity: "e",
    layout: { sections: [{ fields }] },
  };
}

function entityWith(fields: EntityDefinition["fields"]): EntityDefinition {
  return { fields } as EntityDefinition;
}

describe("buildFormSchema", () => {
  describe("required field missing → issue on that field", () => {
    const entity = entityWith({ name: { type: "text", required: true } });
    const screen = screenWith(["name"]);

    for (const [label, value] of [
      ['""', ""],
      ["null", null],
      ["undefined", undefined],
      ["[]", [] as unknown[]],
    ] as const) {
      test(label, () => {
        const result = buildFormSchema(entity, screen).safeParse({ name: value });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0]?.path).toEqual(["name"]);
      });
    }
  });

  test("required field missing → issue carries the required-field i18nKey override", () => {
    const entity = entityWith({ name: { type: "text", required: true } });
    const screen = screenWith(["name"]);

    const result = buildFormSchema(entity, screen).safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    if (issue?.code !== "custom") throw new Error("expected a custom issue");
    expect(issue.params).toMatchObject({ i18nKey: REQUIRED_FIELD_I18N_KEY });
  });

  // The seam the bug actually lived in — a schema built here only round-trips
  // through createFormController's validate(), which is what feeds
  // FormSnapshot.errors that render-edit.tsx passes to RenderField. A unit
  // test on buildFormSchema() alone can't catch a break in that hand-off
  // (e.g. zodErrorToFieldIssues not honoring the override).
  test("end-to-end via createFormController: required field left empty → snapshot error carries kumiko.validation.required", () => {
    const entity = entityWith({ name: { type: "text", required: true } });
    const screen = screenWith(["name"]);

    const form = createFormController({
      initial: { name: "" },
      schema: buildFormSchema(entity, screen),
    });

    expect(form.validate()).toBe(false);
    const fieldErrors = form.getSnapshot().errors["name"];
    expect(fieldErrors?.[0]?.i18nKey).toBe(REQUIRED_FIELD_I18N_KEY);
  });

  describe("required field present → no issue", () => {
    const entity = entityWith({ name: { type: "number", required: true } });
    const screen = screenWith(["name"]);

    for (const [label, value] of [
      ["0", 0],
      ["false", false],
      ['"Ada"', "Ada"],
    ] as const) {
      test(label, () => {
        const result = buildFormSchema(entity, screen).safeParse({ name: value });
        expect(result.success).toBe(true);
      });
    }
  });

  test("optional field left empty → no issue", () => {
    const entity = entityWith({ name: { type: "text", required: false } });
    const screen = screenWith(["name"]);
    expect(buildFormSchema(entity, screen).safeParse({ name: "" }).success).toBe(true);
  });

  test("required field not rendered by the layout → no issue", () => {
    const entity = entityWith({
      name: { type: "text", required: true },
      hidden: { type: "text", required: true },
    });
    const screen = screenWith(["name"]);
    const result = buildFormSchema(entity, screen).safeParse({ name: "Ada", hidden: "" });
    expect(result.success).toBe(true);
  });

  test("required multiSelect, empty array → issue on that field (#1925: has a combobox widget now)", () => {
    const entity = entityWith({
      tags: { type: "multiSelect", required: true, options: ["a", "b"] },
    });
    const screen = screenWith(["tags"]);
    const result = buildFormSchema(entity, screen).safeParse({ tags: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.path).toEqual(["tags"]);
  });

  test("required multiSelect, non-empty array → no issue", () => {
    const entity = entityWith({
      tags: { type: "multiSelect", required: true, options: ["a", "b"] },
    });
    const screen = screenWith(["tags"]);
    expect(buildFormSchema(entity, screen).safeParse({ tags: ["a"] }).success).toBe(true);
  });

  test("jsonb field → no issue (no editable widget on the auto-wired path)", () => {
    const entity = entityWith({ data: { type: "jsonb" } });
    const screen = screenWith(["data"]);
    expect(buildFormSchema(entity, screen).safeParse({ data: undefined }).success).toBe(true);
  });

  test("required embedded field → no issue (no editable widget on the auto-wired path)", () => {
    const entity = entityWith({
      lines: { type: "embedded", required: true, schema: {} },
    });
    const screen = screenWith(["lines"]);
    expect(buildFormSchema(entity, screen).safeParse({ lines: undefined }).success).toBe(true);
  });

  test("required files field → no issue (#1925: no multi-upload widget yet, deliberately deferred)", () => {
    const entity = entityWith({ attachments: { type: "files" } });
    const screen = screenWith([{ field: "attachments", required: true }]);
    expect(buildFormSchema(entity, screen).safeParse({ attachments: undefined }).success).toBe(
      true,
    );
  });

  test("required images field → no issue (#1925: no multi-upload widget yet, deliberately deferred)", () => {
    const entity = entityWith({ gallery: { type: "images" } });
    const screen = screenWith([{ field: "gallery", required: true }]);
    expect(buildFormSchema(entity, screen).safeParse({ gallery: undefined }).success).toBe(true);
  });

  test("required money — bare number (create-form representation) → no issue", () => {
    const entity = entityWith({ price: { type: "money", required: true } });
    const screen = screenWith(["price"]);
    expect(buildFormSchema(entity, screen).safeParse({ price: 1000 }).success).toBe(true);
  });

  test("required money — {amount,currency} (update-form representation) → no issue", () => {
    const entity = entityWith({ price: { type: "money", required: true } });
    const screen = screenWith(["price"]);
    const result = buildFormSchema(entity, screen).safeParse({
      price: { amount: 10, currency: "EUR" },
    });
    expect(result.success).toBe(true);
  });

  test("required money — undefined → issue on that field (has a widget)", () => {
    const entity = entityWith({ price: { type: "money", required: true } });
    const screen = screenWith(["price"]);
    const result = buildFormSchema(entity, screen).safeParse({ price: undefined });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.path).toEqual(["price"]);
  });

  describe("screen-spec required/readOnly override the entity default", () => {
    test("spec required:false on an entity-required field, left empty → no issue", () => {
      const entity = entityWith({ x: { type: "text", required: true } });
      const screen = screenWith([{ field: "x", required: false }]);
      expect(buildFormSchema(entity, screen).safeParse({ x: "" }).success).toBe(true);
    });

    test("spec required:true on an entity-optional field, left empty → issue on that field", () => {
      const entity = entityWith({ x: { type: "text", required: false } });
      const screen = screenWith([{ field: "x", required: true }]);
      const result = buildFormSchema(entity, screen).safeParse({ x: "" });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.path).toEqual(["x"]);
    });

    test("readOnly field, entity-required and left empty → no issue (unresolvable by the user)", () => {
      const entity = entityWith({ x: { type: "text", required: true } });
      const screen = screenWith([{ field: "x", readOnly: true }]);
      expect(buildFormSchema(entity, screen).safeParse({ x: "" }).success).toBe(true);
    });

    test("conditional required, entity-optional field", () => {
      const entity = entityWith({
        kind: { type: "text", required: false },
        x: { type: "text", required: false },
      });
      const screen = screenWith([
        "kind",
        { field: "x", required: { field: "kind", eq: "business" } },
      ]);

      const notTriggered = buildFormSchema(entity, screen).safeParse({ kind: "private", x: "" });
      expect(notTriggered.success).toBe(true);

      const triggered = buildFormSchema(entity, screen).safeParse({ kind: "business", x: "" });
      expect(triggered.success).toBe(false);
      if (triggered.success) return;
      expect(triggered.error.issues).toHaveLength(1);
      expect(triggered.error.issues[0]?.path).toEqual(["x"]);
    });
  });
});
