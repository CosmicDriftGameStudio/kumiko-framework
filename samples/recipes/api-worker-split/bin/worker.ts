// Worker process — consumes the worker-lane BullMQ queue and applies the
// multiStreamProjections the API skipped. No HTTP surface.
//
// wireComponents runs after the entrypoint is up and hands over
// `dispatchSystemWrite` — a dispatcher-scoped system write. The job's
// write-bridge is wired here (fw#1717): JobContext has no write/query, so
// background components persist through this dispatcher instead.
//
// ponytail: BullMQ may pop jobs between entrypoint.start() and this hook —
// those hits throw "no fulfill-write bridge wired" and rely on BullMQ retry
// until the bridge is set. Upgrade: defer job registration until after wire,
// or hold fulfillWrite behind a deferred Promise.
import { runWorkerApp } from "@cosmicdrift/kumiko-server-runtime";
import { createApiWorkerSplitFeature, setOrderFulfillWrite } from "../src/feature";

await runWorkerApp({
  features: [createApiWorkerSplitFeature()],
  jobs: { queueNamePrefix: "api-worker-split" },
  wireComponents: async ({ dispatchSystemWrite }) => {
    setOrderFulfillWrite(({ handlerQn, payload, tenantId }) =>
      dispatchSystemWrite({ handlerQn, payload, tenantId }),
    );
  },
});
