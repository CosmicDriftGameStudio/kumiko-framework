// Contact with embedded address — address belongs 1:1 to the contact,
// is never shared, and is always read/written together. `phoneNumbers` is the
// same idea for N rows: written whole with the contact, no per-row history.

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEmbeddedField,
  createEmbeddedListField,
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
    // A list of like-shaped rows. A phone number has no lifetime of its own —
    // editing the contact rewrites the whole list. Something that starts and
    // ends on its own (a contract position, a subscription) would be its own
    // entity referencing the contact instead.
    phoneNumbers: createEmbeddedListField({
      label: { type: "text", required: true, searchable: true },
      number: { type: "text", required: true },
      note: { type: "text", access: { read: ["Admin"] } },
    }),
  },
});

export const contactTable = buildEntityTable("contact", contactEntity);
