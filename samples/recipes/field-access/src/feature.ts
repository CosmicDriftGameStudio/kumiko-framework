// Field Access Sample
// Shows: Role-based field visibility (read/write per field per role).

import {
  createEntity,
  createNumberField,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@kumiko/framework/engine";

export const employeeEntity = createEntity({
  table: "read_sample_employees",
  fields: {
    name: createTextField({ required: true }),
    email: createTextField({ required: true }),
    // Salary: only Admin and Accounting can read, only Admin can write
    salary: createNumberField({
      access: { read: ["Admin", "Accounting"], write: ["Admin"] },
    }),
    // Internal notes: only Admin can read and write
    internalNotes: createTextField({
      access: { read: ["Admin"], write: ["Admin"] },
    }),
  },
});

const allRoles = { access: { roles: ["Admin", "Accounting", "Employee"] } } as const;

export const employeeFeature = defineFeature("hr", (r) => {
  r.entity("employee", employeeEntity);

  r.writeHandler(defineEntityWriteHandler("employee:create", employeeEntity, allRoles));
  r.writeHandler(defineEntityWriteHandler("employee:update", employeeEntity, allRoles));
  r.queryHandler(defineEntityQueryHandler("employee:detail", employeeEntity, allRoles));
});
