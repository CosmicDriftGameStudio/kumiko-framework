// Currency — tenant-owned, each tenant manages their own currency list
// No global reference data — tenants create currencies themselves

import { buildDrizzleTable } from "@kumiko/framework/db";
import { createBooleanField, createEntity, createTextField } from "@kumiko/framework/engine";

export const currencyEntity = createEntity({
  table: "read_sample_mt_currencies",
  fields: {
    code: createTextField({ required: true }),
    name: createTextField({ required: true }),
    isActive: createBooleanField({ default: true }),
  },
});

export const currencyTable = buildDrizzleTable("currency", currencyEntity);
