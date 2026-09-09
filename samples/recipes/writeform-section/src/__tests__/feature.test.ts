// WriteForm Section Sample — Unit Test (no DB / HTTP needed).
// Proves:
//   - note-desk boots clean (r.translations covers the writeForm
//     pseudo-entity keys required by fw editable-detail-screens)
//   - the writeForm section's field list on note-detail is identical to
//     the entityEdit section's field list on note-edit — the precondition
//     for the e2e layout-parity comparison between the two forms

import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  createTextField,
  defineFeature,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { noteDeskFeature } from "../feature";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function fieldName(spec: string | { readonly field: string }): string {
  return typeof spec === "string" ? spec : spec.field;
}

const registry = createRegistry([noteDeskFeature]);

describe("writeform-section sample — registration", () => {
  test("validateBoot accepts the full registered app", () => {
    expect(() => validateBoot([noteDeskFeature])).not.toThrow();
  });

  test("note-edit registers as entityEdit with one fields section", () => {
    const screen = registry.getScreen("note-desk:screen:note-edit");
    if (screen?.type !== "entityEdit") throw new Error("expected entityEdit");
    expect(screen.layout.sections).toHaveLength(1);
    expect(screen.layout.sections[0]?.kind).toBeUndefined();
  });

  test("note-detail registers as projectionDetail with one writeForm section", () => {
    const screen = registry.getScreen("note-desk:screen:note-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(screen.layout.sections).toHaveLength(1);
    expect(screen.layout.sections[0]?.kind).toBe("writeForm");
  });

  test("the writeForm section and the entityEdit section render the same field list", () => {
    const editScreen = registry.getScreen("note-desk:screen:note-edit");
    const detailScreen = registry.getScreen("note-desk:screen:note-detail");
    if (editScreen?.type !== "entityEdit") throw new Error("expected entityEdit");
    if (detailScreen?.type !== "projectionDetail") throw new Error("expected projectionDetail");

    const editSection = editScreen.layout.sections[0];
    const detailSection = detailScreen.layout.sections[0];
    if (
      editSection === undefined ||
      editSection.kind === "extension" ||
      editSection.kind === "relatedList" ||
      detailSection?.kind !== "writeForm"
    ) {
      throw new Error("expected an entityEdit fields section and a writeForm section");
    }

    const editFields = editSection.fields.map(fieldName);
    const writeFormFields = detailSection.fields.map(fieldName);
    expect(writeFormFields).toEqual(editFields);
  });

  test("the writeForm section's fieldDefs cover every field it renders", () => {
    const detailScreen = registry.getScreen("note-desk:screen:note-detail");
    if (detailScreen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const section = detailScreen.layout.sections[0];
    if (section?.kind !== "writeForm") throw new Error("expected writeForm section");
    for (const spec of section.fields) {
      expect(Object.keys(section.fieldDefs)).toContain(fieldName(spec));
    }
  });
});

describe("writeform-section sample — boot-validator catches author mistakes", () => {
  test("a writeForm field without its pseudo-entity translation key fails boot", () => {
    const broken = defineFeature("broken-note-desk", (r) => {
      r.translations({ keys: { "screen:x.title": { en: "X" } } });
      r.queryHandler("foo:detail", z.object({ id: z.string() }), async () => ({}), {
        access: { openToAll: true },
      });
      r.writeHandler("save", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "x",
        type: "projectionDetail",
        query: "broken-note-desk:query:foo:detail",
        layout: {
          sections: [
            {
              kind: "writeForm",
              title: "s",
              fieldDefs: { name: createTextField() },
              fields: ["name"],
              handler: "broken-note-desk:write:save",
            },
          ],
        },
      });
    });

    expect(() => validateBootRaw([broken])).toThrow(
      '[i18n] Feature "broken-note-desk": required translation key missing: "broken-note-desk:entity:__write-form-section__:field:name"',
    );
  });
});
