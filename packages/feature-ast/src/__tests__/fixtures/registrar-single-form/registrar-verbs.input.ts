import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.optionalRequires("billing", "mail");
  r.readsConfig("orders:limit", "orders:mode");
  r.relation("order", "owner", { kind: "belongsTo", to: "user" });
  const limit = r.config("limit", { type: "number", default: 5 });
  r.job("nightly", { trigger: { cron: "0 0 * * *" } }, nightlyHandler);
  r.notification("orderPlaced", { trigger: { on: "order" } });
  r.referenceData("country", countries, { upsertKey: "code" });
  r.referenceData("currency", currencies);
  r.metric("placed", { kind: "counter" });
  r.secret("apiKey", { description: "key" });
  r.secretNamespace("tenant", { description: "ns" });
  r.claimKey("plan", { type: "string" });
  r.streamHandler("export", exportSchema, exportHandler, { access });
  queue.job("not-a-registrar", { retries: 1 }, run);
});
