import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const inspectionProtocolEditScreen: EntityEditScreenDefinition = {
  id: "inspection-protocol-edit",
  type: "entityEdit",
  entity: "inspection-protocol",
  layout: {
    width: "full",
    sections: [
      {
        columns: 1,
        fields: [
          "measuringDevice",
          {
            field: "checkpoints",
            embeddedList: { readOnlyCells: ["label", "kind", "min", "max"], fixedRows: true },
          },
        ],
      },
      { columns: 1, fields: ["continuedOperation", "condition"] },
    ],
  },
};
