import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { connectorExecutor } from "../schema/connector.ts";

export const connectorNameQuery = defineQueryHandler({
  name: "connector-name",
  schema: z.object({ connectorId: z.uuid() }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: the name an admin gave a connector when pairing it, for the heartbeat answer.",
  handler: async (query, ctx) => {
    const connector = await connectorExecutor.detail(
      { id: query.payload.connectorId },
      query.user,
      ctx.db,
    );
    return connector ? { name: connector.name } : null;
  },
});
