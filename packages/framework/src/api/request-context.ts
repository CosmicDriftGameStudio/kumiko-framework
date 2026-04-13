import { AsyncLocalStorage } from "node:async_hooks";
import { v4 as uuid } from "uuid";

export type RequestContextData = {
  readonly requestId: string;
  readonly tenantId: number;
  readonly userId: number;
};

const storage = new AsyncLocalStorage<RequestContextData>();

export const requestContext = {
  /** Run a function with request context (set in Hono middleware) */
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  /** Get current request context (returns undefined outside a request) */
  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  /** Generate a new requestId (use X-Request-ID header or create one) */
  generateId(): string {
    return uuid();
  },
};
