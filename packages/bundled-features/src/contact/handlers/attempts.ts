import {
  createSystemUser,
  type HandlerContext,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { IN_APP_NOTIFICATION_QUERIES } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { DeliveryQueries } from "../../delivery/index.ts";
import { SYSTEM_ADMIN_ROLE } from "../lib.ts";

// Both queries accept at most this many keys per call.
const MAX_KEYS_PER_QUERY = 50;

const instant = z.custom<Temporal.Instant>((value) => value instanceof Temporal.Instant);

const attemptSchema = z.object({
  key: z.string(),
  channel: z.string(),
  recipientId: z.string().nullable(),
  status: z.string(),
  createdAt: instant,
});
const attemptsResultSchema = z.object({ rows: z.array(attemptSchema) });

const readStateResultSchema = z.object({
  rows: z.array(z.object({ key: z.string(), readAt: instant.nullable() })),
});

export type ContactAttempt = z.infer<typeof attemptSchema>;

function chunked(keys: readonly string[]): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  for (let start = 0; start < keys.length; start += MAX_KEYS_PER_QUERY) {
    chunks.push(keys.slice(start, start + MAX_KEYS_PER_QUERY));
  }
  return chunks;
}

export async function loadAttemptsByKey(
  ctx: Pick<HandlerContext, "dispatch">,
  user: SessionUser,
  keys: readonly string[],
): Promise<readonly ContactAttempt[]> {
  const rows: ContactAttempt[] = [];
  for (const chunk of chunked(keys)) {
    const result = await ctx.dispatch.queryAs(user, DeliveryQueries.attemptsByKeys, {
      keys: chunk,
    });
    rows.push(...attemptsResultSchema.parse(result).rows);
  }
  return rows;
}

// The in-app notes of a request live in the reporter's tenant, so the read state is asked there.
// Empty when channel-in-app is not mounted: nothing can have been read then.
export async function loadReadAtByKey(
  ctx: Pick<HandlerContext, "dispatch" | "registry">,
  reporterTenantId: TenantId,
  keys: readonly string[],
): Promise<ReadonlyMap<string, Temporal.Instant | null>> {
  const readAtByKey = new Map<string, Temporal.Instant | null>();
  if (ctx.registry.getQueryHandler(IN_APP_NOTIFICATION_QUERIES.readStateByKeys) === undefined) {
    return readAtByKey;
  }
  const user = createSystemUser(reporterTenantId, [SYSTEM_ADMIN_ROLE]);
  for (const chunk of chunked(keys)) {
    const result = await ctx.dispatch.queryAs(user, IN_APP_NOTIFICATION_QUERIES.readStateByKeys, {
      keys: chunk,
    });
    for (const row of readStateResultSchema.parse(result).rows)
      readAtByKey.set(row.key, row.readAt);
  }
  return readAtByKey;
}
