import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("manual", (r) => {
  r.job(...jobArgs);
  r.metric("only-name");
  r.config("some-key", def);
  r.relation("order", "owner");
  r.optionalRequires(featureNames);
  queue.job("not-a-registrar", { retries: 1 }, run);
});

export function unresolvedReceiver(): void {
  r.secret("apiKey", { description: "key" });
}
