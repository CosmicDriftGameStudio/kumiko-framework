import {
  createEntity,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// The externally-sourced draft (e.g. an AI extraction from an inbox item).
// Seeded via the standard CRUD create — `prospect:accept` is the only path
// that ever moves it from "pending" to "accepted".
export const suggestionEntity = createEntity({
  table: "read_sample_suggestions",
  fields: {
    name: createTextField({ required: true, searchable: true }),
    email: createTextField({ format: "email" }),
    company: createTextField(),
    notes: createTextField(),
    status: createSelectField({
      options: ["pending", "accepted", "rejected"] as const,
      default: "pending",
    }),
  },
});
