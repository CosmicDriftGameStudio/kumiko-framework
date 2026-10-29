import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEmbeddedListField,
  createEntity,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

const isMeasurement = { field: "kind", eq: "measurement" } as const;
const isNotOk = { field: "result", eq: "not_ok" } as const;

export const inspectionProtocolEntity = createEntity({
  table: "read_sample_inspection_protocols",
  fields: {
    measuringDevice: createTextField({ personal: false, reason: "is_business_data" }),
    checkpoints: createEmbeddedListField(
      {
        label: { type: "text", required: true },
        kind: { type: "select", options: ["check", "measurement"], required: true },
        min: { type: "number", visibleWhen: isMeasurement },
        max: { type: "number", visibleWhen: isMeasurement },
        measured: { type: "number", visibleWhen: isMeasurement },
        result: {
          type: "select",
          options: ["ok", "not_ok"],
          display: "radio",
          optionTones: { ok: "ok", not_ok: "bad" },
        },
        finding: { type: "text", visibleWhen: isNotOk, requiredWhen: isNotOk },
        photos: {
          type: "images",
          capture: "environment",
          maxCount: 5,
          accept: ["jpg", "jpeg", "png"],
          visibleWhen: isNotOk,
          requiredWhen: isNotOk,
        },
        documents: { type: "files", maxCount: 3 },
        approvedBy: { type: "text", access: { write: ["Admin"] } },
      },
      {
        personal: false,
        reason: "is_business_data",
        derived: {
          result: {
            op: "inRange",
            from: ["measured", "min", "max"],
            inside: "ok",
            outside: "not_ok",
            when: isMeasurement,
          },
        },
      },
    ),
    continuedOperation: createSelectField({
      options: ["yes", "with_condition", "no"],
      display: "radio",
      optionTones: { yes: "ok", with_condition: "warn", no: "bad" },
    }),
    condition: createTextField({
      personal: false,
      reason: "is_business_data",
      visibleWhen: { field: "continuedOperation", eq: "with_condition" },
      requiredWhen: { field: "continuedOperation", eq: "with_condition" },
    }),
  },
});

export const inspectionProtocolTable = buildEntityTable(
  "inspection-protocol",
  inspectionProtocolEntity,
);
