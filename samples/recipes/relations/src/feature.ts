import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const teamEntity = createEntity({
  table: "read_sample_teams",
  fields: {
    name: createTextField({ required: true }),
  },
});

export const memberEntity = createEntity({
  table: "read_sample_members",
  fields: {
    name: createTextField({ required: true }),
    teamId: createTextField({ required: true }),
    role: createTextField(),
  },
});

export const taskEntity = createEntity({
  table: "read_sample_member_tasks",
  fields: {
    title: createTextField({ required: true }),
    memberId: createTextField({ required: true }),
  },
});

export const teamTable = buildEntityTable("team", teamEntity);
export const memberTable = buildEntityTable("member", memberEntity);
export const taskTable = buildEntityTable("task", taskEntity);

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;
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
