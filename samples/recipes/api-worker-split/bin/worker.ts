// Worker process — consumes the worker-lane BullMQ queue and applies the
// multiStreamProjections the API skipped. No HTTP surface.
//
// wireComponents runs after the entrypoint is up and hands over
// `dispatchSystemWrite` — a dispatcher-scoped system write. The job's
// write-bridge is wired here (fw#1717): JobContext has no write/query, so
// background components persist through this dispatcher instead.
import { runWorkerApp } from "@cosmicdrift/kumiko-server-runtime";
import {
  createApiWorkerSplitFeature,
  SAMPLE_TENANT_ID,
  setOrderFulfillWrite,
} from "../src/feature";

await runWorkerApp({
  features: [createApiWorkerSplitFeature()],
  jobs: { queueNamePrefix: "api-worker-split" },
  wireComponents: async ({ dispatchSystemWrite }) => {
    setOrderFulfillWrite(({ handlerQn, payload }) =>
      dispatchSystemWrite({ handlerQn, payload, tenantId: SAMPLE_TENANT_ID }),
    );
  },
});
