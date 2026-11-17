import { createFieldApprovalFeature } from "@cosmicdrift/kumiko-bundled-features/field-approval";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const contactEntity = createEntity({
  name: "contact",
  table: "read_sample_fa_contacts",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
    // Only an Accountant changes the IBAN directly; a PropertyManager files a request instead.
    iban: createTextField({
      maxLength: 34,
      personal: "self",
      find: "secret",
      access: { approve: ["Accountant"], write: ["PropertyManager", "Accountant"] },
    }),
  },
});

const roles = ["PropertyManager", "Accountant"] as const;
const crudAccess = { access: { roles } } as const;

export const contactFeature = defineFeature("contacts", (r) => {
  r.crud(contactEntity, {
    write: crudAccess,
    read: crudAccess,
    verbs: { delete: false, list: false, restore: false },
  });
});

export const fieldApprovalFeature = createFieldApprovalFeature({
  parents: ["contact"],
  roles,
});
