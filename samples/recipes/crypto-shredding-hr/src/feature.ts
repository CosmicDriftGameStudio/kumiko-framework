import {
  createEntity,
  createTextField,
  defineFeature,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";

export const employeeEntity = createEntity({
  table: "read_hr_employees",
  fields: {
    displayName: createTextField({ required: true, pii: true }),
    email: createTextField({ required: true, format: "email", pii: true, lookupable: true }),
    department: createTextField({ sortable: true }),
  },
  softDelete: true,
});

export const hrCommentEntity = createEntity({
  table: "read_hr_comments",
  fields: {
    employeeId: createTextField({ required: true }),
    body: createTextField({ required: true, userOwned: { ownerField: "employeeId" } }),
    authorName: createTextField(),
  },
  softDelete: true,
});

const hrWrite = { access: { roles: ["Admin"] } } as const;
const hrRead = { access: { roles: ["Admin"] } } as const;

export const hrFeature = defineFeature("hr", (r) => {
  registerEntityCrud(r, "employee", employeeEntity, {
    write: hrWrite,
    read: hrRead,
    verbs: { update: false, delete: false, restore: false },
  });

  registerEntityCrud(r, "hr-comment", hrCommentEntity, {
    write: hrWrite,
    read: hrRead,
    verbs: { update: false, delete: false, restore: false, list: false },
  });
});
