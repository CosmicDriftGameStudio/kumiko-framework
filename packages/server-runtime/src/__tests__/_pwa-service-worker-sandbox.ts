// Runs the generated service worker script against an in-memory stand-in for the worker
// globals (self, caches, fetch), so tests drive real install/activate/fetch events.

export const SANDBOX_ORIGIN = "https://app.example";

type SandboxRequest = {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly headers: Headers;
};

type FetchEventLike = {
  readonly request: SandboxRequest;
  respondWith: (response: Promise<Response>) => void;
};

type ExtendableEventLike = { waitUntil: (work: Promise<unknown>) => void };

type NetworkHandler = (url: string) => Response | Promise<Response>;

function keyOf(request: SandboxRequest | string): string {
  return typeof request === "string" ? new URL(request, SANDBOX_ORIGIN).href : request.url;
}

// Real same-origin fetches answer with type "basic"; a constructed Response says "default".
function markBasic(response: Response): Response {
  const cloneResponse = response.clone.bind(response);
  Object.defineProperty(response, "type", { value: "basic" });
  Object.defineProperty(response, "clone", { value: () => markBasic(cloneResponse()) });
  return response;
}

export function redirectedBasicResponse(body: string): Response {
  const response = basicResponse(body);
  Object.defineProperty(response, "redirected", { value: true });
  return response;
}

export function basicResponse(body: string, init: ResponseInit = {}): Response {
  return markBasic(new Response(body, init));
}

export type ServiceWorkerSandbox = {
  readonly cacheStore: Map<string, Map<string, Response>>;
  readonly networkRequests: string[];
  readonly calls: { skipWaiting: number; claim: number };
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /** undefined: the worker did not call respondWith, the browser handles the request itself. */
  dispatchFetch: (
    path: string,
    init?: { method?: string; mode?: string; accept?: string },
  ) => Promise<Response | undefined>;
  setNetwork: (handler: NetworkHandler) => void;
};

export function runServiceWorkerScript(
  script: string,
  cacheStore = new Map<string, Map<string, Response>>(),
): ServiceWorkerSandbox {
  const listeners = new Map<string, (event: unknown) => void>();
  const networkRequests: string[] = [];
  const calls = { skipWaiting: 0, claim: 0 };
  let network: NetworkHandler = (url) => basicResponse(`network:${new URL(url).pathname}`);

  const openCache = (name: string): Map<string, Response> => {
    const existing = cacheStore.get(name);
    if (existing) return existing;
    const created = new Map<string, Response>();
    cacheStore.set(name, created);
    return created;
  };

  const caches = {
    open: async (name: string) => {
      const entries = openCache(name);
      return {
        put: async (request: SandboxRequest | string, response: Response) => {
          entries.set(keyOf(request), response);
        },
        match: async (request: SandboxRequest | string) => entries.get(keyOf(request))?.clone(),
      };
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name: string) => cacheStore.delete(name),
  };

  const self = {
    location: { origin: SANDBOX_ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    skipWaiting: async () => {
      calls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        calls.claim += 1;
      },
    },
  };

  const fetchStub = async (request: SandboxRequest | string): Promise<Response> => {
    const url = keyOf(request);
    networkRequests.push(new URL(url).pathname);
    return network(url);
  };

  // The worker constructs requests with `new`; a relative URL resolves against the worker's
  // origin, as it does inside a real worker.
  class RequestStub implements SandboxRequest {
    readonly url: string;
    readonly method = "GET";
    readonly mode = "cors";
    readonly headers = new Headers();
    constructor(input: string) {
      this.url = new URL(input, SANDBOX_ORIGIN).href;
    }
  }

  new Function("self", "caches", "fetch", "Request", script)(self, caches, fetchStub, RequestStub);

  const runExtendable = async (type: string): Promise<void> => {
    const work: Promise<unknown>[] = [];
    const event: ExtendableEventLike = { waitUntil: (promise) => work.push(promise) };
    listeners.get(type)?.(event);
    await Promise.all(work);
  };

  return {
    cacheStore,
    networkRequests,
    calls,
    install: () => runExtendable("install"),
    activate: () => runExtendable("activate"),
    dispatchFetch: async (path, init = {}) => {
      let responded: Promise<Response> | undefined;
      const headers = new Headers();
      if (init.accept) headers.set("accept", init.accept);
      const event: FetchEventLike = {
        request: {
          url: new URL(path, SANDBOX_ORIGIN).href,
          method: init.method ?? "GET",
          mode: init.mode ?? "cors",
          headers,
        },
        respondWith: (response) => {
          responded = response;
        },
      };
      listeners.get("fetch")?.(event);
      return responded;
    },
    setNetwork: (handler) => {
      network = handler;
    },
  };
}
