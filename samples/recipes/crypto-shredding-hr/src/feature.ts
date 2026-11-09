import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

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

const hrCommentTable = buildEntityTable("hr-comment", hrCommentEntity);
const hrCommentExecutor = createEventStoreExecutor(hrCommentTable, hrCommentEntity, {
  entityName: "hr-comment",
});

const purgeArchivedCommentsPayload = z.object({ commentIds: z.array(z.uuid()) });

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

  // A job runs without a write-handler entry, so the irreversible-operation gate refuses
  // `forget` here unless the job declares why it may. Remove the declaration and the run fails.
  r.job(
    "purge-archived-comments",
    {
      trigger: { manual: true },
      runIn: "worker",
      irreversibleWithoutEntryHandler: "high-risk-or-cron-pipeline",
    },
    async (payload, ctx) => {
      const { commentIds } = purgeArchivedCommentsPayload.parse(payload);
      for (const id of commentIds) {
        const result = await hrCommentExecutor.forget({ id }, ctx.systemUser, ctx.db);
        if (!result.isSuccess) throw new Error(`purge of hr-comment ${id} failed`);
      }
    },
  );
});
