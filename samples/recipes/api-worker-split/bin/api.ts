// API process — `runSingleInstance: false` makes this process API-only:
// HTTP + event writes + BullMQ ENQUEUE, no worker-lane consumption, no
// multiStreamProjection application. A dedicated worker MUST run next to
// it (bin/worker.ts) or the read-side stays empty.
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { createApiWorkerSplitFeature } from "../src/feature";

await runProdApp({
  features: [createApiWorkerSplitFeature()],
  runSingleInstance: false,
  // worker-lane queue prefix; must match bin/worker.ts.
  jobs: { queueNamePrefix: "api-worker-split" },
});
