// Retention with files: a hardDelete entity whose file field is cleaned up together with the
// row. runRetentionCleanup removes the bytes (and derivatives) and the file_refs row first,
// then the row itself; the cron in data-retention does the same with the tenant's FileContext.

import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const retainedDocEntity = createEntity({
  table: "store_retained_docs",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    attachment: createFileField(),
  },
  retention: { keepFor: "30d", strategy: "hardDelete", reference: "createdAt" },
});

export const retainedDocsFeature = defineFeature("retained-docs", (r) => {
  r.entity({ name: "retained-doc", ...retainedDocEntity });
  r.writeHandler(
    defineEntityCreateHandler("retained-doc", retainedDocEntity, {
      access: { roles: ["Admin"] },
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("retained-doc", retainedDocEntity, {
      access: { roles: ["Admin"] },
    }),
  );
});
