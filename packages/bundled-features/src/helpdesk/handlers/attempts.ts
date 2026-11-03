import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  createSystemUser,
  type HandlerContext,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { chunk } from "@cosmicdrift/kumiko-framework/utils";
import { IN_APP_NOTIFICATION_QUERIES } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { DeliveryQueries } from "../../delivery/index.ts";

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

export type HelpdeskAttempt = z.infer<typeof attemptSchema>;

export async function loadAttemptsByKey(
  ctx: Pick<HandlerContext, "dispatch">,
  user: SessionUser,
  keys: readonly string[],
): Promise<readonly HelpdeskAttempt[]> {
  const rows: HelpdeskAttempt[] = [];
  for (const keyChunk of chunk(keys, MAX_KEYS_PER_QUERY)) {
    const result = await ctx.dispatch.queryAs(user, DeliveryQueries.attemptsByKeys, {
      keys: keyChunk,
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
  const user = createSystemUser(reporterTenantId, [ROLES.SystemAdmin]);
  for (const keyChunk of chunk(keys, MAX_KEYS_PER_QUERY)) {
    const result = await ctx.dispatch.queryAs(user, IN_APP_NOTIFICATION_QUERIES.readStateByKeys, {
      keys: keyChunk,
    });
    for (const row of readStateResultSchema.parse(result).rows)
      readAtByKey.set(row.key, row.readAt);
  }
  return readAtByKey;
}
