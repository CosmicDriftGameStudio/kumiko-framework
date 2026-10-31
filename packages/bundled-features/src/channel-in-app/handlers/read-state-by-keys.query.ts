import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { inAppMessagesTable } from "../tables.ts";

const MAX_KEYS = 50;

type MessageRow = {
  readonly idempotencyKey: string | null;
  readonly readAt: Temporal.Instant | null;
};

export const readStateByKeysQuery = defineQueryHandler({
  name: "readStateByKeys",
  schema: z.object({ keys: z.array(z.string().min(1).max(256)).min(1).max(MAX_KEYS) }).strict(),
  access: { roles: access.systemAdmin },
  description:
    "Returns when the in-app message sent under each given notify() idempotency key was read (null while unread), within the caller's tenant and without any message content; a SystemAdmin queries the recipient's tenant by acting as a system user of it. Use it to show whether a recipient has seen a notification a feature sent under a known key.",
  handler: async (query, ctx) => {
    const rows = await selectMany<MessageRow>(
      ctx.db,
      inAppMessagesTable,
      { idempotencyKey: { in: query.payload.keys } },
      { orderBy: [{ col: "createdAt", direction: "asc" }] },
    );
    const states = new Map<string, Temporal.Instant | null>();
    for (const row of rows) {
      if (row.idempotencyKey !== null && !states.has(row.idempotencyKey)) {
        states.set(row.idempotencyKey, row.readAt);
      }
    }
    return { rows: [...states].map(([key, readAt]) => ({ key, readAt })) };
  },
});
