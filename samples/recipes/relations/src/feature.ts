// Relations Sample
// Shows: hasMany relation, onDelete: cascade vs restrict, parent-child entities.

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

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
    // UUID foreign keys are stored as text columns so the string UUID fits.
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

// Tables exported so the integration test can wire the cascade-delete hook.
export const teamTable = buildDrizzleTable("team", teamEntity);
export const memberTable = buildDrizzleTable("member", memberEntity);
export const taskTable = buildDrizzleTable("task", taskEntity);

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;

export const relationsFeature = defineFeature("org", (r) => {
  const team = r.entity("team", teamEntity);
  const member = r.entity("member", memberEntity);
  r.entity("task", taskEntity);

  // Team has many members — restrict delete when members exist.
  r.relation(team, "members", {
    type: "hasMany",
    target: "member",
    foreignKey: "teamId",
    onDelete: "restrict",
  });

  // Member has many tasks — cascade delete tasks when member is deleted.
  r.relation(member, "tasks", {
    type: "hasMany",
    target: "task",
    foreignKey: "memberId",
    onDelete: "cascade",
  });

  r.writeHandler(defineEntityCreateHandler("team", teamEntity, adminWrite));
  r.writeHandler(defineEntityCreateHandler("member", memberEntity, adminWrite));
  r.writeHandler(defineEntityCreateHandler("task", taskEntity, adminWrite));
  r.queryHandler(defineEntityDetailHandler("task", taskEntity, openRead));
});
