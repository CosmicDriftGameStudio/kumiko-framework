// API process — `runSingleInstance: false` makes this process API-only:
// HTTP + event writes + BullMQ ENQUEUE, no worker-lane consumption, no
// multiStreamProjection application. A dedicated worker MUST run next to
// it (bin/worker.ts) or the read-side stays empty.
import { frameworkCoreEnvSchema } from "@cosmicdrift/kumiko-dev-server/env-schema";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { createApiWorkerSplitFeature } from "../src/feature";

const features = [createApiWorkerSplitFeature()];

await runProdApp({
  features,
  envSchema: composeEnvSchema({ core: frameworkCoreEnvSchema, features }),
  runSingleInstance: false,
  // worker-lane queue prefix; must match bin/worker.ts.
  jobs: { queueNamePrefix: "api-worker-split" },
});
