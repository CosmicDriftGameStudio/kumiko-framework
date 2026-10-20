import {
  type ActionFormScreenDefinition,
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
    minItems: 1,
    derived: { vatAmount: { op: "percent", from: ["amount", "vatRate"] } },
    totals: [
      { label: "invoice.total.net", from: ["amount"] },
      { label: "invoice.total.vat", from: ["vatAmount"] },
      { label: "invoice.total.gross", from: ["amount", "vatAmount"] },
    ],
  },
);

// Net/VAT/gross are derived on the server from the lines (at least one is required)
// and shown only in the list footer, so the head totals are declared but not laid out.
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
    vatTotal: { type: "money", currency: euro },
    grossTotal: { type: "money", currency: euro },
  },
  derive: {
    netTotal: { op: "listSum", list: "lines", cell: "amount" },
    vatTotal: { op: "listSum", list: "lines", cell: "vatAmount" },
    grossTotal: { op: "sum", from: ["netTotal", "vatTotal"] },
  },
  layout: {
    sections: [
      { columns: 2, fields: ["supplier", "invoiceNumber"] },
      { columns: 1, fields: ["lines"] },
    ],
  },
};
