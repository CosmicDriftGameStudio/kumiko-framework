import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEmbeddedListField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// Invoice line-items — the motivating case for select/reference/derived/
// totals metadata on createEmbeddedListField: each line references a
// product, has a unit (select), and a derived amount (qty × unitPrice)
// that the entity sums across all lines.
export const invoiceEntity = createEntity({
  table: "read_sample_invoices",
  fields: {
    customer: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    // Business data, so the list can search it: invoice-receive redirects here by number.
    invoiceNumber: createTextField({
      personal: false,
      reason: "is_business_data",
      searchable: true,
    }),
    lines: createEmbeddedListField(
      {
        product: { type: "reference", entity: "product", required: true },
        unit: { type: "select", options: ["pcs", "hours", "kg"], required: true },
        quantity: { type: "number", required: true },
        unitPrice: { type: "money", required: true },
        amount: { type: "money" },
      },
      {
        required: true,
        minItems: 1,
        maxItems: 5,
        derived: { amount: { op: "multiply", from: ["quantity", "unitPrice"] } },
        totals: ["amount"],
      },
    ),
  },
});

export const invoiceTable = buildEntityTable("invoice", invoiceEntity);
