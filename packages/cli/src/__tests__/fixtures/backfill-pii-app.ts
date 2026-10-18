import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const BACKFILL_CONTACT_TABLE = "read_clibf_contacts";

export const backfillContactEntity = createEntity({
  table: BACKFILL_CONTACT_TABLE,
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
    displayName: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

export default {
  features: [
    defineFeature("clibf", (r) => {
      r.entity({ name: "clibfcontact", ...backfillContactEntity });
    }),
  ],
};
