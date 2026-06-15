import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeEditViewModel } from "../edit";
import type { EditFieldsSectionViewModel, EditSectionViewModel } from "../types";

function asFields(s: EditSectionViewModel | undefined): EditFieldsSectionViewModel {
  if (s === undefined || s.kind !== "fields") {
    throw new Error(`expected fields-section, got ${s?.kind ?? "undefined"}`);
  }
  return s;
}

const orderEntity = {
  fields: {
    customerName: { type: "text", required: true },
    notes: { type: "text" },
    vatExempt: { type: "boolean" },
    vatReason: { type: "text" },
  },
} as unknown as EntityDefinition;

function editScreen(
  layout: EntityEditScreenDefinition["layout"],
  overrides?: Partial<EntityEditScreenDefinition>,
): EntityEditScreenDefinition {
  return {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout,
    ...overrides,
  };
}

const translate = (key: string) => key;

describe("computeEditViewModel", () => {
  test("flat screen: single section, string-form fields → resolved field view models", () => {
    const vm = computeEditViewModel({
      screen: editScreen({
        sections: [{ title: "Hauptdaten", fields: ["customerName", "notes"] }],
      }),
      entity: orderEntity,
      values: { customerName: "Acme", notes: "VIP" },
      translate,
      featureName: "orders",
    });

    expect(vm.sections).toHaveLength(1);
    const section = vm.sections[0];
    expect(section?.title).toBe("Hauptdaten");
    expect(asFields(section).columns).toBe(1); // default
    expect(asFields(section).fields).toEqual([
      {
        field: "customerName",
        label: "orders:entity:order:field:customerName",
        type: "text",
        value: "Acme",
        visible: true,
        readOnly: false,
        required: true, // from entity
      },
      {
        field: "notes",
        label: "orders:entity:order:field:notes",
        type: "text",
        value: "VIP",
        visible: true,
        readOnly: false,
        required: false,
      },
    ]);
  });

  test("fieldLabels override the convention key per field; absent fields fall back", () => {
    const vm = computeEditViewModel({
      screen: editScreen(
        { sections: [{ title: "Main", fields: ["customerName", "notes"] }] },
        { fieldLabels: { customerName: "config:mask:customer-name" } },
      ),
      entity: orderEntity,
      values: {},
      translate,
      featureName: "orders",
    });

    const fields = asFields(vm.sections[0]).fields;
    // overridden field uses the injected i18n key (the Settings-Hub puts mask.title here)
    expect(fields[0]?.label).toBe("config:mask:customer-name");
    // un-overridden field stays on the `<feature>:entity:<entity>:field:<name>` convention
    expect(fields[1]?.label).toBe("orders:entity:order:field:notes");
  });

  test("section.columns override is respected; defaults to 1 when absent", () => {
    const vm = computeEditViewModel({
      screen: editScreen({
        sections: [
          { title: "Main", columns: 2, fields: ["customerName"] },
          { title: "Notes", fields: ["notes"] },
        ],
      }),
      entity: orderEntity,
      values: {},
      translate,
      featureName: "orders",
    });

    expect(asFields(vm.sections[0]).columns).toBe(2);
    expect(asFields(vm.sections[1]).columns).toBe(1);
  });

  test("visible predicate evaluated against current values (live-reactive)", () => {
    const screen = editScreen({
      sections: [
        {
          title: "VAT",
          fields: [
            "vatExempt",
            {
              field: "vatReason",
              visible: { field: "vatExempt", eq: true },
              required: { field: "vatExempt", eq: true },
            },
          ],
        },
      ],
    });

    const hidden = computeEditViewModel({
      screen,
      entity: orderEntity,
      values: { vatExempt: false },
      translate,
      featureName: "orders",
    });
    const reasonHidden = asFields(hidden.sections[0]).fields[1];
    expect(reasonHidden?.visible).toBe(false);
    expect(reasonHidden?.required).toBe(false);

    const shown = computeEditViewModel({
      screen,
      entity: orderEntity,
      values: { vatExempt: true },
      translate,
      featureName: "orders",
    });
    const reasonShown = asFields(shown.sections[0]).fields[1];
    expect(reasonShown?.visible).toBe(true);
    expect(reasonShown?.required).toBe(true);
  });

  test("readonly condition { field, ne } evaluates against form values", () => {
    const screen = editScreen({
      sections: [
        {
          title: "x",
          fields: [{ field: "customerName", readOnly: { field: "isEditable", ne: true } }],
        },
      ],
    });

    const locked = computeEditViewModel({
      screen,
      entity: orderEntity,
      values: { customerName: "A", isEditable: false },
      translate,
      featureName: "orders",
    });
    expect(asFields(locked.sections[0]).fields[0]?.readOnly).toBe(true);

    const editable = computeEditViewModel({
      screen,
      entity: orderEntity,
      values: { customerName: "A", isEditable: true },
      translate,
      featureName: "orders",
    });
    expect(asFields(editable.sections[0]).fields[0]?.readOnly).toBe(false);
  });

  test("screen-level required override wins over entity-level required", () => {
    // customerName is required:true on the entity. Screen marks it
    // required:false — a short-form wizard might collect less up-front.
    const vm = computeEditViewModel({
      screen: editScreen({
        sections: [
          {
            title: "x",
            fields: [{ field: "customerName", required: false }],
          },
        ],
      }),
      entity: orderEntity,
      values: {},
      translate,
      featureName: "orders",
    });

    expect(asFields(vm.sections[0]).fields[0]?.required).toBe(false);
  });

  test("id is extracted from values or null on create (no existing row)", () => {
    const create = computeEditViewModel({
      screen: editScreen({ sections: [{ title: "x", fields: ["customerName"] }] }),
      entity: orderEntity,
      values: { customerName: "new" },
      translate,
      featureName: "orders",
    });
    expect(create.id).toBeNull();

    const edit = computeEditViewModel({
      screen: editScreen({ sections: [{ title: "x", fields: ["customerName"] }] }),
      entity: orderEntity,
      values: { id: "o-1", customerName: "existing" },
      translate,
      featureName: "orders",
    });
    expect(edit.id).toBe("o-1");
  });

  test("unknown field in a section throws — no silent-ignore of a typo", () => {
    expect(() =>
      computeEditViewModel({
        screen: editScreen({ sections: [{ title: "x", fields: ["ghost"] }] }),
        entity: orderEntity,
        values: {},
        translate,
        featureName: "orders",
      }),
    ).toThrow(/unknown field "ghost"/);
  });

  test("slots pass through for the renderer to mount", () => {
    const slots = { header: { react: "H" } };
    const vm = computeEditViewModel({
      screen: editScreen({ sections: [{ title: "x", fields: ["customerName"] }] }, { slots }),
      entity: orderEntity,
      values: {},
      translate,
      featureName: "orders",
    });
    expect(vm.slots).toBe(slots);
  });

  test("span on field-spec propagates to the view model", () => {
    const vm = computeEditViewModel({
      screen: editScreen({
        sections: [{ title: "x", columns: 3, fields: [{ field: "customerName", span: 2 }] }],
      }),
      entity: orderEntity,
      values: {},
      translate,
      featureName: "orders",
    });
    expect(asFields(vm.sections[0]).fields[0]?.span).toBe(2);
  });
});

describe("computeEditViewModel — date/timestamp min/max/locale (#369)", () => {
  test("date-Field reicht min/max/locale ins ViewModel", () => {
    const entity = {
      fields: {
        born: { type: "date", min: "1900-01-01", max: "2026-06-15", locale: "en-US" },
      },
    } as unknown as EntityDefinition;
    const vm = computeEditViewModel({
      screen: editScreen({ sections: [{ title: "X", fields: ["born"] }] }),
      entity,
      values: {},
      translate,
      featureName: "orders",
    });
    const field = asFields(vm.sections[0]).fields[0];
    expect(field?.min).toBe("1900-01-01");
    expect(field?.max).toBe("2026-06-15");
    expect(field?.dateLocale).toBe("en-US");
  });

  test("date-Field ohne bounds: min/max/dateLocale bleiben weg", () => {
    const entity = {
      fields: { born: { type: "date" } },
    } as unknown as EntityDefinition;
    const vm = computeEditViewModel({
      screen: editScreen({ sections: [{ title: "X", fields: ["born"] }] }),
      entity,
      values: {},
      translate,
      featureName: "orders",
    });
    const field = asFields(vm.sections[0]).fields[0];
    expect(field?.min).toBeUndefined();
    expect(field?.max).toBeUndefined();
    expect(field?.dateLocale).toBeUndefined();
  });
});
