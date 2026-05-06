// Contact with embedded address — address belongs 1:1 to the contact,
// is never shared, and is always read/written together

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEmbeddedField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const contactEntity = createEntity({
  table: "read_sample_contacts",
  fields: {
    name: createTextField({ required: true, searchable: true }),
    email: createTextField({ format: "email" }),
    address: createEmbeddedField(
      {
        street: { type: "text", required: true, searchable: true },
        zip: { type: "text", required: true },
        city: { type: "text", required: true, searchable: true },
        country: { type: "text" },
      },
      { required: true },
    ),
    billingAddress: createEmbeddedField({
      street: { type: "text", required: true },
      zip: { type: "text", required: true },
      city: { type: "text", required: true },
      country: { type: "text" },
      vatId: { type: "text", access: { read: ["Admin", "Accounting"] } },
    }),
  },
});

export const contactTable = buildDrizzleTable("contact", contactEntity);
