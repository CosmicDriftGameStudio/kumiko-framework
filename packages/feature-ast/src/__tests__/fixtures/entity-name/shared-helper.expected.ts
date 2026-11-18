import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const invoiceEntity = createEntity({ fields: {} });
const receiptEntity = createEntity({ fields: {} });

function withSoftDelete<T extends object>(entity: T) {
  return { ...entity, softDelete: true };
}

export const feature = defineFeature("billing", (r) => {
  r.entity({ name: "invoice", ...withSoftDelete(invoiceEntity) });
  r.entity({ name: "receipt", ...withSoftDelete(receiptEntity) });
});
