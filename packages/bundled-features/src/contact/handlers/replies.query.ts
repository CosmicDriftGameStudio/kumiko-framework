import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { adminAccess, contactDb, listRepliesOf, platformActor, requestExecutor } from "../lib.ts";
import { ContactIdSchema } from "../payloads.ts";
import { CONTACT_REQUEST_ENTITY } from "../web/constants.ts";

export const repliesQuery = defineQueryHandler({
  name: "replies",
  schema: ContactIdSchema,
  access: adminAccess,
  description:
    "Returns the answers SystemAdmins sent to one contact request (id, sent time, author name, message), oldest first, as flat rows for a related list; the request itself is not part of it.",
  handler: async (event, ctx) => {
    const db = contactDb(ctx);
    const { id } = event.payload;
    const request = await requestExecutor.detail({ id }, platformActor(), db);
    if (!request) throw new NotFoundError(CONTACT_REQUEST_ENTITY, id);
    const replies = await listRepliesOf(db, id);
    return {
      rows: replies.map((reply) => ({
        id: reply.id,
        sentAt: reply.sentAt.toString(),
        authorName: reply.authorName,
        message: reply.message,
      })),
      nextCursor: null,
    };
  },
});
