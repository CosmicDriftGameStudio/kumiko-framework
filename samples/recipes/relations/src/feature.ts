import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const teamEntity = createEntity({
  table: "read_sample_teams",
  fields: {
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

export const memberEntity = createEntity({
  table: "read_sample_members",
  fields: {
    name: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    teamId: createTextField({ personal: false, reason: "is_system_identifier", required: true }),
    role: createTextField({ personal: false, reason: "is_business_data" }),
  },
});

export const taskEntity = createEntity({
  table: "read_sample_member_tasks",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    memberId: createTextField({ personal: "ref", required: true }),
  },
});

export const teamTable = buildEntityTable("team", teamEntity);
export const memberTable = buildEntityTable("member", memberEntity);
export const taskTable = buildEntityTable("task", taskEntity);

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

export const relationsFeature = defineFeature("org", (r) => {
  const team = r.entity("team", teamEntity);
  const member = r.entity("member", memberEntity);

  r.relation(team, "members", {
    type: "hasMany",
    target: "member",
    foreignKey: "teamId",
    onDelete: "restrict",
  });

  r.relation(member, "tasks", {
    type: "hasMany",
    target: "task",
    foreignKey: "memberId",
    onDelete: "cascade",
  });

  r.crud("team", teamEntity, {
    write: adminWrite,
    verbs: createOnly,
    registerEntity: false,
  });
  r.crud("member", memberEntity, {
    write: adminWrite,
    verbs: createOnly,
    registerEntity: false,
  });
  r.crud("task", taskEntity, {
    write: adminWrite,
    read: openRead,
    verbs: { ...createOnly, detail: true },
  });
});
