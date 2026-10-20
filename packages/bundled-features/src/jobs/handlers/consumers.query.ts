import { defineQueryHandler, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  type ConsumerProgress,
  getAllConsumerProgress,
  getConsumerState,
  SEARCH_CONSUMER_NAME,
  SSE_BROADCAST_CONSUMER_NAME,
} from "@cosmicdrift/kumiko-framework/pipeline";
import * as z from "zod";
import { CONSUMER_ID_SEPARATOR, CONSUMER_STATUSES, type ConsumerStatus } from "../web/constants.ts";

const LAST_ERROR_PREVIEW_LENGTH = 90;

// Dead consumers are what support looks for, so they lead the default order.
const STATUS_RANK: Readonly<Record<ConsumerStatus, number>> = {
  dead: 0,
  disabled: 1,
  processing: 2,
  "never-run": 3,
  idle: 4,
};

export function consumerRowId(name: string, instanceId: string): string {
  return `${name}${CONSUMER_ID_SEPARATOR}${instanceId}`;
}

export function splitConsumerRowId(id: string): { name: string; instanceId: string } | null {
  const at = id.lastIndexOf(CONSUMER_ID_SEPARATOR);
  if (at <= 0) return null;
  return { name: id.slice(0, at), instanceId: id.slice(at + 1) };
}

function registeredConsumerNames(registry: Registry): readonly string[] {
  return [
    SSE_BROADCAST_CONSUMER_NAME,
    SEARCH_CONSUMER_NAME,
    ...registry.getAllMultiStreamProjections().keys(),
  ];
}

function previewOf(error: string | null): string | null {
  if (error === null || error.length <= LAST_ERROR_PREVIEW_LENGTH) return error;
  return `${error.slice(0, LAST_ERROR_PREVIEW_LENGTH).trimEnd()}…`;
}

function toRow(c: ConsumerProgress) {
  return {
    id: consumerRowId(c.name, c.instanceId),
    name: c.name,
    instanceId: c.instanceId,
    status: c.status,
    lag: Number(c.lag),
    attempts: c.attempts,
    lastError: previewOf(c.lastError),
  };
}

const statusFilterSchema = z.strictObject({
  field: z.literal("status"),
  op: z.literal("in"),
  value: z.array(z.enum(CONSUMER_STATUSES)),
});

export const consumersQuery = defineQueryHandler({
  name: "consumers",
  description:
    "Lists every event consumer (projections, search indexer, SSE broadcaster) with status, lag behind the event store and last error, dead consumers first; use it to find a stuck consumer.",
  schema: z.object({
    filters: z.array(statusFilterSchema).max(1).optional(),
    sort: z.enum(["name", "status", "lag", "attempts"]).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "jobs:query:consumers requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    const db = ctx.systemDb.unsafeRaw(
      "event consumer state is global dispatcher state, not tenant data",
    );
    const progress = await getAllConsumerProgress(db, registeredConsumerNames(ctx.registry));
    const statuses = query.payload.filters?.[0]?.value;
    const visible = statuses
      ? progress.filter((c) => statuses.some((s) => s === c.status))
      : progress;
    const direction = query.payload.sortDirection === "desc" ? -1 : 1;
    const sort = query.payload.sort;
    const compare = (a: ConsumerProgress, b: ConsumerProgress): number => {
      if (sort === "name") return a.name.localeCompare(b.name) * direction;
      if (sort === "lag") return Number(a.lag - b.lag) * direction;
      if (sort === "attempts") return (a.attempts - b.attempts) * direction;
      const rank = (c: ConsumerProgress) => STATUS_RANK[c.status as ConsumerStatus] ?? 5;
      return (rank(a) - rank(b)) * direction || a.name.localeCompare(b.name);
    };
    return { rows: [...visible].sort(compare).map(toRow), nextCursor: null };
  },
});

export const consumerDetailQuery = defineQueryHandler({
  name: "consumer-details",
  description:
    "Returns one event consumer with its status, lag, attempts, the full last error and the time of its last state change; use it to decide between restart, skip and pause.",
  schema: z.object({ consumerId: z.string().min(1) }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "jobs:query:consumer-details requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    const target = splitConsumerRowId(query.payload.consumerId);
    if (!target) return null;
    const db = ctx.systemDb.unsafeRaw(
      "event consumer state is global dispatcher state, not tenant data",
    );
    const all = await getAllConsumerProgress(db, registeredConsumerNames(ctx.registry));
    const progress = all.find((c) => c.name === target.name && c.instanceId === target.instanceId);
    if (!progress) return null;
    const state = await getConsumerState(db, target.name, target.instanceId);
    return {
      ...toRow(progress),
      lastError: progress.lastError,
      updatedAt: state ? state.updatedAt.toString() : null,
    };
  },
});
