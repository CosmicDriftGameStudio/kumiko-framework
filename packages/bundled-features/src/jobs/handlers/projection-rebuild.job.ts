// Single-run projection-rebuild worker (`jobs:job:projection-rebuild`); manually triggered, typically via enqueueProjectionRebuild to refill an emptied projection.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { z } from "zod";

export const projectionRebuildPayloadSchema = z.object({ projection: z.string().min(1) });

export const projectionRebuildJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const { projection } = projectionRebuildPayloadSchema.parse(rawPayload);
  if (!ctx.db) {
    throw new InternalError({
      message:
        "[jobs:projection-rebuild] ctx.db missing — job context requires a database connection.",
    });
  }
  if (!ctx.registry) {
    throw new InternalError({
      message:
        "[jobs:projection-rebuild] ctx.registry missing — job context requires the registry.",
    });
  }
  const db = ctx.db as DbConnection; // @cast-boundary db-operator
  const result = await rebuildProjection(projection, { db, registry: ctx.registry });
  ctx.log?.info?.(
    `[jobs:projection-rebuild] rebuilt ${projection}: ${result.eventsProcessed} events in ${result.durationMs}ms`,
  );
};
