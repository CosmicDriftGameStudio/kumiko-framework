// Currency — tenant-owned, each tenant manages their own currency list
// No global reference data — tenants create currencies themselves

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const currencyEntity = createEntity({
  table: "read_sample_mt_currencies",
  fields: {
    code: createTextField({ personal: false, reason: "is_reference_data", required: true }),
    name: createTextField({ personal: false, reason: "is_reference_data", required: true }),
    isActive: createBooleanField({ default: true }),
  },
});

export const currencyTable = buildEntityTable("currency", currencyEntity);
