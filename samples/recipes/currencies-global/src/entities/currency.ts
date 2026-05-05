// Currency — global reference data table
// Seeded from CURRENCY_CATALOG in feature.ts via r.referenceData()

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";

export const currencyEntity = createEntity({
  table: "read_sample_currencies",
  fields: {
    code: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
});

export const currencyTable = buildDrizzleTable("currency", currencyEntity);
