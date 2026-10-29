import { createEntityExecutor, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { inspectionPlanEntity } from "../entities/inspection-plan";
import { inspectionProtocolEntity } from "../entities/inspection-protocol";

const { executor: planExecutor } = createEntityExecutor("inspection-plan", inspectionPlanEntity);
const { executor: protocolExecutor } = createEntityExecutor(
  "inspection-protocol",
  inspectionProtocolEntity,
);

const planRows = z.array(
  z.object({
    label: z.string(),
    kind: z.enum(["check", "measurement"]),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
);

// Copies only the plan's fixed columns; result, finding and photos stay empty for the inspector.
export const createFromPlan = defineWriteHandler({
  name: "inspection-protocol:create-from-plan",
  schema: z.object({ planId: z.uuid() }),
  access: { roles: ["Admin", "Inspector"] },
  handler: async (event, ctx) => {
    const plan = await planExecutor.detail({ id: event.payload.planId }, event.user, ctx.db);
    if (!plan) return failNotFound("inspection-plan", event.payload.planId);
    const checkpoints = planRows.parse(plan["checkpoints"]).map(({ label, kind, min, max }) => ({
      label,
      kind,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    }));
    return protocolExecutor.create({ checkpoints }, event.user, ctx.db);
  },
});
