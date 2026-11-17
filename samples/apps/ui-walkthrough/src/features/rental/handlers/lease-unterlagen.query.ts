import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { open } from "../access";
import { fileRefIdsPayloadSchema } from "../lease-support";

export const leaseUnterlagenQuery = defineQueryHandler({
  name: "lease:unterlagen",
  schema: fileRefIdsPayloadSchema,
  handler: async (query) => ({
    id: "unterlagen",
    titel: "Unterlagen",
    unterlagen: query.payload.id,
  }),
  ...open,
});
