import {
  createEntity,
  createReferenceField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const teamEntity = createEntity({
  name: "team",
  table: "read_sample_teams",
  fields: {
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

export const memberEntity = createEntity({
  name: "member",
  table: "read_sample_members",
  fields: {
    name: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    teamId: createReferenceField({
      entity: "team",
      personal: false,
      reason: "is_system_identifier",
      required: true,
    }),
    role: createTextField({ personal: false, reason: "is_business_data" }),
  },
});

export const taskEntity = createEntity({
  name: "task",
  table: "read_sample_member_tasks",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    memberId: createReferenceField({ entity: "member", personal: "ref", required: true }),
  },
});

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = {
  access: {
    openToAll: {
      reason: "any signed-in user may read a task by id; writes are still gated by adminWrite",
    },
  },
} as const;
const createOnly = {
  update: false,
  delete: false,
  restore: false,
  list: false,
  detail: false,
} as const;

const createAndDelete = { ...createOnly, delete: true } as const;

export const relationsFeature = defineFeature("org", (r) => {
  const team = r.entity(teamEntity);
  const member = r.entity(memberEntity);

  r.relation({ entity: team, name: "members", type: "hasMany",
    target: "member",
    foreignKey: "teamId",
    onDelete: "restrict" });

  r.relation({ entity: member, name: "tasks", type: "hasMany",
    target: "task",
    foreignKey: "memberId",
    onDelete: "cascade" });

  // onDelete runs automatically in the delete lifecycle: deleting a team is refused while
  // members exist, deleting a member removes its tasks.
  r.crud(teamEntity, {
    write: adminWrite,
    verbs: createAndDelete,
    registerEntity: false,
  });
  r.crud(memberEntity, {
    write: adminWrite,
    verbs: createAndDelete,
    registerEntity: false,
  });
  r.crud(taskEntity, {
    write: adminWrite,
    read: openRead,
    verbs: { ...createOnly, detail: true },
  });
});
