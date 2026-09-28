import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const employeeEntity = createEntity({
  table: "read_sample_employees",
  fields: {
    name: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    email: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    salary: createNumberField({
      access: { read: ["Admin", "Accounting"], write: ["Admin"] },
    }),
    internalNotes: createTextField({
      personal: { of: "id" },
      find: "none",
      access: { read: ["Admin"], write: ["Admin"] },
    }),
  },
});

const allRoles = { access: { roles: ["Admin", "Accounting", "Employee"] } } as const;

export const employeeFeature = defineFeature("hr", (r) => {
  r.crud("employee", employeeEntity, {
    write: allRoles,
    read: allRoles,
    verbs: { delete: false, list: false, restore: false },
  });
});
