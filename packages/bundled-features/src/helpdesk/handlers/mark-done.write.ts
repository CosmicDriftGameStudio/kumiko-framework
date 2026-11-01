import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { adminAccess, helpdeskDb, platformActor, requestExecutor } from "../lib.ts";
import { HelpdeskMarkDoneSchema } from "../payloads.ts";
import { HELPDESK_REQUEST_ENTITY, HELPDESK_STATUS } from "../web/constants.ts";

export type HelpdeskMarkDoneData = { readonly kind: "marked"; readonly changed: number };

export const markDoneHandler = defineWriteHandler<
  "mark-done",
  typeof HelpdeskMarkDoneSchema,
  HelpdeskMarkDoneData
>({
  name: "mark-done",
  schema: HelpdeskMarkDoneSchema,
  access: adminAccess,
  agent: { expose: false },
  description:
    "Marks one contact request as done without sending a reply; a finished request is left as it is.",
  handler: async (event, ctx) => {
    const db = helpdeskDb(ctx);
    const { id } = event.payload;
    const request = await requestExecutor.detail({ id }, platformActor(), db);
    if (!request) return writeFailure(new NotFoundError(HELPDESK_REQUEST_ENTITY, id));
    if (request.status === HELPDESK_STATUS.Done) {
      return { isSuccess: true, data: { kind: "marked", changed: 0 } };
    }
    const updated = await requestExecutor.update(
      {
        id,
        version: request.version,
        changes: { status: HELPDESK_STATUS.Done, closedAt: ctx.tz.now() },
      },
      platformActor(),
      db,
    );
    if (!updated.isSuccess) return updated;
    return { isSuccess: true, data: { kind: "marked", changed: 1 } };
  },
});
