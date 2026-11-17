import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// Slow synthetic export — demonstrates ctx.lifecycle.signal honouring inside a
// long-running handler loop. Real-world equivalents: PDF batch export,
// bulk CSV download, multi-stream audit walk. Mobile clients that
// navigate away mid-export should NOT keep the server busy producing
// bytes nobody will read. The handler checks ctx.lifecycle.signal at every
// iteration; on abort, throws and the dispatcher returns an error to
// the (already-disconnected) client.
export const opsSlowExportQuery = defineQueryHandler({
  name: "ops:slow-export",
  schema: z.object({ chunks: z.number().int().min(1).max(1000) }),
  handler: async (query, ctx) => {
    const accumulated: number[] = [];
    for (let i = 0; i < query.payload.chunks; i++) {
      ctx.lifecycle.signal?.throwIfAborted();
      // Fake "work per chunk". Realistic handler would assemble a row,
      // hit a remote service, etc.
      await new Promise((resolve) => setTimeout(resolve, 10));
      accumulated.push(i);
    }
    return { processed: accumulated.length };
  },
  access: { roles: ["Admin"] },
});
