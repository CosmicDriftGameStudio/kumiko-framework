import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.optionalRequires({ features: ["billing", "mail"] });
  r.readsConfig({ keys: ["orders:limit", "orders:mode"] });
  r.relation({ entity: "order", name: "owner", kind: "belongsTo", to: "user" });
  const limit = r.config({ keys: { limit: { type: "number", default: 5 } } }).limit;
  r.job({ name: "nightly", trigger: { cron: "0 0 * * *" }, handler: nightlyHandler });
  r.notification({ name: "orderPlaced", trigger: { on: "order" } });
  r.referenceData({ entity: "country", data: countries, upsertKey: "code" });
  r.referenceData({ entity: "currency", data: currencies });
  r.metric({ name: "placed", kind: "counter" });
  r.secret({ name: "apiKey", description: "key" });
  r.secretNamespace({ name: "tenant", description: "ns" });
  r.claimKey({ name: "plan", type: "string" });
  r.streamHandler({ name: "export", schema: exportSchema, handler: exportHandler, access });
  queue.job("not-a-registrar", { retries: 1 }, run);
});
