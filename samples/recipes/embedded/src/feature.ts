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

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { contactEntity } from "./entities/contact";
import { contactCreate } from "./handlers/contact-create.write";
import { contactDetail } from "./handlers/contact-detail.query";

export { contactEntity } from "./entities/contact";

export const embeddedFeature = defineFeature("contacts", (r) => {
  r.entity("contact", contactEntity);

  r.writeHandler(contactCreate);
  r.queryHandler(contactDetail);
});
