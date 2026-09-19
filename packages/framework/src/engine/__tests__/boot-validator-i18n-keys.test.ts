import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

describe("validateBoot — i18n surface keys", () => {
  test("passes when screen-derived keys are in r.translations", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("throws when screen title key is missing", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
      r.translations({
        keys: {
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /required translation key missing: "screen:item-list.title"/,
    );
  });

  test("throws when feature has screens but no r.translations", () => {
    const feature = defineFeature("legacy", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/required translation key missing/);
  });

  test("does not require every locale on every key", () => {
    const feature = defineFeature("demo", (r) => {
      r.nav({ id: "home", label: "demo:nav.home" });
      r.translations({
        keys: {
          "demo:nav.home": { de: "Start" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});

// fw#2986: requiredKeysFromScreen read only section.fields, so a field declared
// through section.groups — and every groups[].title — slipped past this guard.
describe("validateBoot — i18n surface keys from section.groups (fw#2986)", () => {
  function groupsFeature(keys: Record<string, { de: string; en: string }>) {
    return defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-edit",
        type: "entityEdit",
        entity: "item",
        layout: {
          sections: [
            {
              fields: [],
              groups: [{ title: "demo:group.basics", fields: ["name"] }],
            },
          ],
        },
      });
      r.translations({ keys });
    });
  }

  const complete = {
    "screen:item-edit.title": { de: "Bearbeiten", en: "Edit" },
    "demo:group.basics": { de: "Basis", en: "Basics" },
    "demo:entity:item:field:name": { de: "Name", en: "Name" },
  };

  test("passes when the group title and the group's field label are translated", () => {
    expect(() => validateBoot([groupsFeature(complete)])).not.toThrow();
  });

  test("throws for a missing label of a field declared only in groups", () => {
    const { "demo:entity:item:field:name": _dropped, ...withoutFieldLabel } = complete;
    expect(() => validateBoot([groupsFeature(withoutFieldLabel)])).toThrow(
      /required translation key missing: "demo:entity:item:field:name"/,
    );
  });

  test("throws for a missing groups[].title translation", () => {
    const { "demo:group.basics": _dropped, ...withoutGroupTitle } = complete;
    expect(() => validateBoot([groupsFeature(withoutGroupTitle)])).toThrow(
      /required translation key missing: "demo:group\.basics"/,
    );
  });
});
