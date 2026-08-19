import {
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Created only through `prospect:accept` — never through a built-in CRUD
// create, so `source`/`acceptedBy`/`acceptedAt` are never on the edit form
// and a client can't set them itself.
export const prospectEntity = createEntity({
  table: "read_sample_prospects",
  fields: {
    name: createTextField({ required: true, personal: "self", find: "fuzzy" }),
    email: createTextField({ format: "email", personal: "self", find: "none" }),
    company: createTextField(),
    notes: createTextField(),
    source: createTextField({ required: true }),
    acceptedBy: createTextField({ required: true }),
    acceptedAt: createTimestampField({ required: true }),
  },
});
