import {
  type ActionFormScreenDefinition,
  createDecimalField,
  createEmbeddedListField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

const euro = { kind: "literal", code: "EUR" } as const;

export const invoiceReceiveLines = createEmbeddedListField(
  {
    description: { type: "text", required: true },
    amount: { type: "money", required: true },
    vatRate: { type: "decimal", scale: 2, required: true },
    vatAmount: { type: "money" },
  },
  {
    derived: { vatAmount: { op: "percent", from: ["amount", "vatRate"] } },
    totals: ["amount", "vatAmount"],
  },
);

// Net/VAT/gross are derived: with line items they are the sum of the lines,
// without lines the net amount and the VAT rate are typed and VAT/gross follow.
export const invoiceReceiveScreen: ActionFormScreenDefinition = {
  id: "invoice-receive",
  type: "actionForm",
  handler: "contacts:write:invoice:receive",
  fields: {
    supplier: createTextField({ required: true, personal: "tenant", find: "none" }),
    invoiceNumber: createTextField({
      required: true,
      personal: false,
      reason: "is_business_data",
    }),
    lines: invoiceReceiveLines,
    netTotal: { type: "money", currency: euro },
    vatRate: createDecimalField({ precision: 5, scale: 2 }),
    vatTotal: { type: "money", currency: euro },
    grossTotal: { type: "money", currency: euro },
  },
  derive: {
    netTotal: { op: "listSum", list: "lines", cell: "amount" },
    vatTotal: {
      op: "listSum",
      list: "lines",
      cell: "vatAmount",
      whenEmpty: { op: "percent", from: ["netTotal", "vatRate"] },
    },
    grossTotal: { op: "sum", from: ["netTotal", "vatTotal"] },
  },
  layout: {
    sections: [
      { columns: 2, fields: ["supplier", "invoiceNumber"] },
      { columns: 1, fields: ["lines"] },
      { columns: 2, fields: ["netTotal", "vatRate", "vatTotal", "grossTotal"] },
    ],
  },
};
