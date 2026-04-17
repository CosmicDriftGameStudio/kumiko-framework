import { AsyncLocalStorage } from "node:async_hooks";
import { v4 as uuid } from "uuid";

// Request-scoped propagation. Populated by the HTTP middleware and by the
// event-dispatcher when it runs an MSP-apply, so ctx.appendEvent downstream
// automatically stamps the right provenance on every event it writes.
//
//   requestId     — unique per HTTP request (or Job run). Log correlation.
//   correlationId — the end-to-end business operation id; propagates across
//                   service boundaries and MSP causation chains. Comes from
//                   the `x-correlation-id` header if set, otherwise mirrors
//                   requestId (clients that don't set the header pay no
//                   penalty — a single HTTP call == one correlation).
//   causationId   — the events.id that triggered THIS execution. Null for
//                   root HTTP commands; set when an MSP-apply is running
//                   (event-dispatcher wraps the handler call). Together
//                   with correlationId, forms a causal DAG across streams.
export type RequestContextData = {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
};

const storage = new AsyncLocalStorage<RequestContextData>();

export const requestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  generateId(): string {
    return uuid();
  },
};
