import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { adminAccess, contactDb, platformActor, requestExecutor } from "../lib.ts";
import { ContactMarkDoneSchema } from "../payloads.ts";
import { CONTACT_REQUEST_ENTITY, CONTACT_STATUS } from "../web/constants.ts";

export type ContactMarkDoneData = { readonly kind: "marked"; readonly changed: number };

export const markDoneHandler = defineWriteHandler<
  "mark-done",
  typeof ContactMarkDoneSchema,
  ContactMarkDoneData
>({
  name: "mark-done",
  schema: ContactMarkDoneSchema,
  access: adminAccess,
  agent: { expose: false },
  description:
    "Marks one contact request as done without sending a reply; a finished request is left as it is.",
  handler: async (event, ctx) => {
    const db = contactDb(ctx);
    const { id } = event.payload;
    const request = await requestExecutor.detail({ id }, platformActor(), db);
    if (!request) return writeFailure(new NotFoundError(CONTACT_REQUEST_ENTITY, id));
    if (request.status === CONTACT_STATUS.Done) {
      return { isSuccess: true, data: { kind: "marked", changed: 0 } };
    }
    const updated = await requestExecutor.update(
      {
        id,
        version: request.version,
        changes: { status: CONTACT_STATUS.Done, closedAt: ctx.tz.now() },
      },
      platformActor(),
      db,
    );
    if (!updated.isSuccess) return updated;
    return { isSuccess: true, data: { kind: "marked", changed: 1 } };
  },
});
