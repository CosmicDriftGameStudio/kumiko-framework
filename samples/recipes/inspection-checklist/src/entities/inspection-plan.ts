import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEmbeddedListField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const inspectionPlanEntity = createEntity({
  table: "read_sample_inspection_plans",
  fields: {
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
    checkpoints: createEmbeddedListField(
      {
        label: { type: "text", required: true },
        kind: { type: "select", options: ["check", "measurement"], required: true },
        min: { type: "number" },
        max: { type: "number" },
      },
      { personal: false, reason: "is_business_data" },
    ),
  },
});

export const inspectionPlanTable = buildEntityTable("inspection-plan", inspectionPlanEntity);
