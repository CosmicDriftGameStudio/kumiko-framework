import { AsyncLocalStorage } from "node:async_hooks";
import type { Span } from "./types";

// Separate ALS from requestContext so observability stays optional — the
// request-id pipeline doesn't need to know about spans, and the span stack
// doesn't need to know about request-ids. Both run alongside each other.

type ObservabilityContextData = {
  readonly activeSpan?: Span;
};

const storage = new AsyncLocalStorage<ObservabilityContextData>();

export const observabilityContext = {
  run<T>(data: ObservabilityContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  get(): ObservabilityContextData | undefined {
    return storage.getStore();
  },

  getActiveSpan(): Span | undefined {
    return storage.getStore()?.activeSpan;
  },
};
