import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const employeeEntity = createEntity({
  table: "read_hr_employees",
  fields: {
    displayName: createTextField({ required: true, personal: "self", find: "none" }),
    email: createTextField({ required: true, format: "email", personal: "self", find: "exact" }),
    department: createTextField({ personal: false, reason: "is_business_data", sortable: true }),
  },
  softDelete: true,
});

export const hrCommentEntity = createEntity({
  table: "read_hr_comments",
  fields: {
    employeeId: createTextField({ personal: "ref", required: true }),
    body: createTextField({ required: true, personal: { of: "employeeId" }, find: "none" }),
    authorName: createTextField({ personal: { of: "id" }, find: "none" }),
  },
  softDelete: true,
});

const hrWrite = { access: { roles: ["Admin"] } } as const;
const hrRead = { access: { roles: ["Admin"] } } as const;

export const hrFeature = defineFeature("hr", (r) => {
  r.crud("employee", employeeEntity, {
    write: hrWrite,
    read: hrRead,
    verbs: { update: false, delete: false, restore: false },
  });

  r.crud("hr-comment", hrCommentEntity, {
    write: hrWrite,
    read: hrRead,
    verbs: { update: false, delete: false, restore: false, list: false },
  });
});
