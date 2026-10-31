import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { deliveryAttemptsTable } from "../tables.ts";
import { toClientError } from "./log.query.ts";

const MAX_KEYS = 50;

export const attemptsByKeysQuery = defineQueryHandler({
  name: "attempts-by-keys",
  schema: z.object({ keys: z.array(z.string().min(1).max(256)).min(1).max(MAX_KEYS) }).strict(),
  access: { roles: access.systemAdmin },
  description:
    "Returns the delivery attempts (channel, status, error code, time, recipient id, never an address) recorded for notify() calls made with one of the given idempotency keys, across all tenants; use it to show whether a notification a feature sent under a known key arrived.",
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({ message: "attempts-by-keys requires ctx.systemDb" });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "SystemAdmin reads delivery attempts of a notification across tenants",
    );
    const rows = await selectMany<{
      id: string;
      idempotencyKey: string | null;
      notificationType: string;
      channel: string;
      recipientId: string | null;
      status: string;
      error: string | null;
      createdAt: Temporal.Instant;
    }>(
      db,
      deliveryAttemptsTable,
      { idempotencyKey: { in: query.payload.keys } },
      { orderBy: [{ col: "createdAt", direction: "asc" }] },
    );
    return {
      rows: rows
        // "*" rows only record that a duplicate key was skipped.
        .filter((row) => row.channel !== "*")
        .map((row) => ({
          id: row.id,
          key: row.idempotencyKey,
          notificationType: row.notificationType,
          channel: row.channel,
          recipientId: row.recipientId,
          status: row.status,
          error: toClientError(row.error),
          createdAt: row.createdAt,
        })),
    };
  },
});
