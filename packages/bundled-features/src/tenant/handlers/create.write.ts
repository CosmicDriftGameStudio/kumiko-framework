import { createEventStoreExecutor } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../tenant-entity";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

// Optional `id`: SystemAdmin-only handler — legitimer Pfad für Seeds und
// externe Provisionierung (SCIM, IdP-Sync, Migration aus bestehenden Systemen),
// wo der Tenant mit einer vom Caller gewählten UUID angelegt werden muss.
// Wenn nicht gesetzt, Postgres vergibt via gen_random_uuid() eine neue UUID.
export const createWrite = defineWriteHandler({
  name: "create",
  schema: z.object({
    id: z.uuid().optional(),
    key: z.string().min(1).max(50),
    name: z.string().min(1).max(200),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => crud.create(event.payload, event.user, ctx.db),
});
