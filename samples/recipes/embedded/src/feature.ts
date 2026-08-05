// Embedded Object Sample
// Shows: Embedded objects stored as JSONB, searchable sub-fields,
// field access on sub-fields, required vs optional embedded objects
//
// Pattern: Address belongs 1:1 to contact — never shared, always read together.
// Use embedded when: data is owned by the parent entity, not referenced elsewhere.
//
// Tables:
//   contact — with embedded address (required) and billingAddress (optional)
//             address.street and address.city are searchable
//             billingAddress.vatId has restricted field access
//   product — minimal entity, only exists so `invoice.lines` has something
//             to reference
//   invoice — embedded list with select/reference/derived/totals metadata
//             on its `lines` sub-fields (Issue #1835), plus a declarative
//             entityEdit screen that renders the list end-to-end via
//             EmbeddedListField, no custom-screen code required

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { contactEntity } from "./entities/contact";
import { invoiceEntity } from "./entities/invoice";
import { productEntity } from "./entities/product";
import { contactCreate } from "./handlers/contact-create.write";
import { contactDetail } from "./handlers/contact-detail.query";

export { contactEntity } from "./entities/contact";
export { invoiceEntity } from "./entities/invoice";
export { productEntity } from "./entities/product";

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;

export const embeddedFeature = defineFeature("contacts", (r) => {
  r.entity("contact", contactEntity);

  r.writeHandler(contactCreate);
  r.queryHandler(contactDetail);

  r.crud("product", productEntity, { write: adminWrite, read: openRead });
  r.crud("invoice", invoiceEntity, { write: adminWrite, read: openRead });

  r.screen({
    id: "invoice-edit",
    type: "entityEdit",
    entity: "invoice",
    layout: {
      sections: [{ columns: 1, fields: ["customer", "lines"] }],
    },
  });
});
