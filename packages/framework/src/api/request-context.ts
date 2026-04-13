import { AsyncLocalStorage } from "node:async_hooks";
import { v4 as uuid } from "uuid";

export type RequestContextData = {
  readonly requestId: string;
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
