// Kitchen-Sink Entity — alle Field-Types die DefaultInput rendert
// (text, number, boolean, date) plus die Layout-Features die der
// renderer-web kann: Section-Sperre, Spaltigkeit, Span, Conditional
// Visibility, Conditional Required, Custom Column-Renderer in der List.
//
// Was bewusst FEHLT: select, money, embedded, file/image — die
// dazugehörigen Primitives sind in DefaultInput noch nicht eingezogen.
// Sobald sie da sind, gehören sie hier rein.

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";

export const itemEntity = {
  fields: {
    // Text-Varianten
    title: { type: "text", required: true, sortable: true, searchable: true },
    notes: { type: "text" },
    // Number mit Default
    priority: { type: "number", default: 1, sortable: true },
    // Boolean mit Default
    isDone: { type: "boolean", default: false, sortable: true },
    // Date — nativer date-Input des Browsers
    dueDate: { type: "date" },
  },
} as unknown as EntityDefinition;

export const itemEditScreen: EntityEditScreenDefinition = {
  id: "item-edit",
  type: "entityEdit",
  entity: "item",
  layout: {
    sections: [
      {
        // Erste Section — Section-Title rendert als Banner-artige Headline
        title: "Basics",
        columns: 2,
        // span: 2 lässt das Feld die ganze Breite belegen
        fields: [
          { field: "title", span: 2 },
          "priority",
          "isDone",
        ],
      },
      {
        title: "Details",
        columns: 1,
        fields: [
          // Conditional Visibility + Required: erscheint nur wenn isDone=true,
          // ist dann auch required. Beweist die FieldCondition-Pipe.
          {
            field: "notes",
            visible: (d) => (d as { isDone?: boolean }).isDone === true,
            required: (d) => (d as { isDone?: boolean }).isDone === true,
          },
          "dueDate",
        ],
      },
    ],
  },
};

export const itemListScreen: EntityListScreenDefinition = {
  id: "item-list",
  type: "entityList",
  entity: "item",
  columns: [
    "title",
    // Boolean-Spalte: DataTable-Primitive rendert ✓ / ✗
    "isDone",
    // Custom-Renderer: Number → "P{n}" oder "—" wenn 0
    {
      field: "priority",
      renderer: (v: unknown) => (v === undefined || v === 0 ? "—" : `P${v}`),
    },
    "dueDate",
  ],
};
