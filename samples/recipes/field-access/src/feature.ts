import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";

export const employeeEntity = createEntity({
  table: "read_sample_employees",
  fields: {
    name: createTextField({ required: true }),
    email: createTextField({ required: true }),
    salary: createNumberField({
      access: { read: ["Admin", "Accounting"], write: ["Admin"] },
    }),
    internalNotes: createTextField({
      access: { read: ["Admin"], write: ["Admin"] },
    }),
  },
});

const allRoles = { access: { roles: ["Admin", "Accounting", "Employee"] } } as const;

export const employeeFeature = defineFeature("hr", (r) => {
  registerEntityCrud(r, "employee", employeeEntity, {
    write: allRoles,
    read: allRoles,
    verbs: { delete: false, list: false, restore: false },
  });
});
