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
  sectionFieldSpecs,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
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
      editSection.kind === "stepList" ||
      detailSection?.kind !== "writeForm"
    ) {
      throw new Error("expected an entityEdit fields section and a writeForm section");
    }

    const editFields = sectionFieldSpecs(editSection).map(fieldName);
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
      r.queryHandler({
        name: "foo:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({}),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.writeHandler({
        name: "save",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
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
              fieldDefs: { name: createTextField({ personal: false, reason: "is_business_data" }) },
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

describe("writeform-section sample — submitWith and narrow options", () => {
  test("note-approval registers the form with submitWith and tab labels", () => {
    expect(() => validateBoot([noteDeskFeature])).not.toThrow();
    const screen = registry.getScreen("note-desk:screen:note-approval");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const form = screen.layout.sections[0];
    if (form?.kind !== "writeForm") throw new Error("expected writeForm section");
    expect(form.submitWith).toBe("approve");
    expect(screen.layout.sections.map((s) => s.tabLabel)).toEqual(["Review", "History"]);
    expect(screen.layout.narrowTabs).toBe(false);
  });

  function approvalFeature(options: {
    readonly submitWith: string;
    readonly payload?: { readonly map: Record<string, string> };
    readonly fields?: readonly string[];
  }) {
    return defineFeature("approval-desk", (r) => {
      r.translations({
        keys: {
          "screen:x.title": { en: "X" },
          "approval-desk:entity:__write-form-section__:field:name": { en: "Name" },
          "approval-desk:entity:__write-form-section__:field:noteId": { en: "Note" },
        },
      });
      const access = {
        openToAll: { reason: "test handler callable by any signed-in test user" },
      } as const;
      r.queryHandler({
        name: "foo:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({}),
        access,
      });
      r.writeHandler({
        name: "approve",
        schema: z.object({}).passthrough(),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access,
      });
      const text = createTextField({ personal: false, reason: "is_business_data" });
      r.screen({
        id: "x",
        type: "projectionDetail",
        query: "approval-desk:query:foo:detail",
        layout: {
          sections: [
            {
              kind: "writeForm",
              title: "s",
              fieldDefs: { name: text, noteId: text },
              fields: options.fields ?? ["name"],
              handler: "approval-desk:write:approve",
              submitWith: options.submitWith,
            },
          ],
        },
        actions: [
          {
            id: "approve",
            label: "Approve",
            handler: "approval-desk:write:approve",
            ...(options.payload !== undefined && { payload: options.payload }),
          },
        ],
      });
    });
  }

  test("in a tabs layout the submitWith action must be limited to the form's tab", () => {
    const tabsFeature = (showOnTabs: readonly string[] | undefined) =>
      defineFeature("tabs-desk", (r) => {
        r.translations({
          keys: {
            "screen:x.title": { en: "X" },
            "tabs-desk:entity:__write-form-section__:field:name": { en: "Name" },
          },
        });
        const access = {
          openToAll: { reason: "test handler callable by any signed-in test user" },
        } as const;
        r.queryHandler({
          name: "foo:detail",
          schema: z.object({ id: z.string() }),
          handler: async () => ({}),
          access,
        });
        r.writeHandler({
          name: "approve",
          schema: z.object({}).passthrough(),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access,
        });
        const text = createTextField({ personal: false, reason: "is_business_data" });
        r.screen({
          id: "x",
          type: "projectionDetail",
          query: "tabs-desk:query:foo:detail",
          layout: {
            mode: "tabs",
            sections: [
              {
                id: "review",
                kind: "writeForm",
                title: "s",
                fieldDefs: { name: text },
                fields: ["name"],
                handler: "tabs-desk:write:approve",
                submitWith: "approve",
              },
              { id: "log", title: "Log", fields: ["name"] },
            ],
          },
          actions: [
            {
              id: "approve",
              label: "Approve",
              handler: "tabs-desk:write:approve",
              ...(showOnTabs !== undefined && { showOnTabs }),
            },
          ],
        });
      });
    expect(() => validateBoot([tabsFeature(undefined)])).toThrow('showOnTabs: ["<that id>"]');
    expect(() => validateBoot([tabsFeature(["review", "log"])])).toThrow("showOnTabs");
    expect(() => validateBoot([tabsFeature(["review"])])).not.toThrow();
  });

  test("submitWith that names no action of the screen fails boot", () => {
    expect(() => validateBoot([approvalFeature({ submitWith: "missing" })])).toThrow(
      'sets submitWith "missing"',
    );
  });

  test("a form field that the action also sends in its payload fails boot", () => {
    expect(() =>
      validateBoot([
        approvalFeature({
          submitWith: "approve",
          payload: { map: { noteId: "id" } },
          fields: ["name", "noteId"],
        }),
      ]),
    ).toThrow('has the field "noteId"');
  });

  test("a valid submitWith boots", () => {
    expect(() =>
      validateBoot([
        approvalFeature({ submitWith: "approve", payload: { map: { noteId: "id" } } }),
      ]),
    ).not.toThrow();
  });
});

describe("writeform-section sample — presentation options are checked at boot", () => {
  function detailFeature(
    layout: ProjectionDetailScreenDefinition["layout"],
    actions?: ProjectionDetailScreenDefinition["actions"],
  ) {
    return defineFeature("layout-desk", (r) => {
      r.translations({ keys: { "screen:x.title": { en: "X" } } });
      r.queryHandler({
        name: "foo:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({}),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "x",
        type: "projectionDetail",
        query: "layout-desk:query:foo:detail",
        layout,
        ...(actions !== undefined && { actions }),
      });
    });
  }
  const fields = ["name"];

  test("hideOnNarrow together with showOnNarrowOnly fails", () => {
    expect(() =>
      validateBoot([
        detailFeature({ sections: [{ fields, hideOnNarrow: true, showOnNarrowOnly: true }] }),
      ]),
    ).toThrow("hideOnNarrow and showOnNarrowOnly");
  });

  test("tabLabel and narrowTabs without tabs mode fail", () => {
    expect(() =>
      validateBoot([detailFeature({ sections: [{ fields, tabLabel: "Tab" }] })]),
    ).toThrow("tabLabel without layout.mode");
    expect(() =>
      validateBoot([detailFeature({ narrowTabs: false, sections: [{ fields }] })]),
    ).toThrow("narrowTabs without layout.mode");
  });

  test("photoGrid.badgeFirst without badgeField fails", () => {
    expect(() =>
      validateBoot([
        detailFeature({
          sections: [
            {
              kind: "relatedList",
              title: "Photos",
              query: "layout-desk:query:foo:detail",
              parentParam: "id",
              columns: [{ field: "name", label: "Name" }],
              photoGrid: { imageField: "name", badgeFirst: true },
            },
          ],
        }),
      ]),
    ).toThrow("badgeFirst without badgeField");
  });

  test("a navigate action with icon: false needs no icon", () => {
    const action = {
      kind: "navigate" as const,
      id: "open-board",
      label: "Board",
      screen: "x",
      icon: false as const,
    };
    expect(() => validateBoot([detailFeature({ sections: [{ fields }] }, [action])])).not.toThrow();
  });
});
