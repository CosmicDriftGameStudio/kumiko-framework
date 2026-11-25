import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeEditViewModel, computeWriteFormSectionViewModel } from "../edit.ts";
import type { EditSectionViewModel, EditWriteFormSectionViewModel } from "../types.ts";

function asWriteForm(s: EditSectionViewModel | undefined): EditWriteFormSectionViewModel {
  if (s === undefined || s.kind !== "writeForm") {
    throw new Error(`expected writeForm-section, got ${s?.kind ?? "undefined"}`);
  }
  return s;
}

const orderEntity = {
  fields: { customerName: { type: "text", required: true } },
} as unknown as EntityDefinition;

const translate = (key: string) => key;

describe("computeEditViewModel — writeForm uploadEntity", () => {
  test("uploadEntity makes a file field upload as that entity's field, in a tab section and in the footer", () => {
    const fieldDefs = { attachment: { type: "file", accept: ["pdf"] } } as never;
    const screen: EntityEditScreenDefinition = {
      id: "thing-detail",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            kind: "writeForm",
            title: "Tab",
            uploadEntity: "dossier",
            fieldDefs,
            fields: ["attachment"],
            handler: "o:write:a",
          },
        ],
      },
    };
    const vm = computeEditViewModel({
      screen,
      entity: orderEntity,
      values: {},
      translate,
      featureName: "orders",
    });
    const footer = computeWriteFormSectionViewModel(
      {
        kind: "writeForm",
        placement: "footer",
        uploadEntity: "dossier",
        fieldDefs,
        fields: ["attachment"],
      },
      "thing-detail",
      {},
      translate,
      "orders",
    );

    for (const section of [asWriteForm(vm.sections[0]), footer]) {
      const [attachment] = section.fields;
      expect(attachment?.entityType).toBe("dossier");
      expect(attachment?.fieldName).toBe("attachment");
      expect(attachment?.entityId).toBeUndefined();
      expect(attachment?.uploadActionForm).toBeUndefined();
    }
  });
});
