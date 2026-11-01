import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";

const originalFetch = globalThis.fetch;

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

export type SeenRequest = { readonly url: string; readonly init: RequestInit | undefined };

export function stubFetch(respond: () => Response | Promise<Response>): SeenRequest[] {
  const seen: SeenRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return seen;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

export function sentBody(request: SeenRequest | undefined): unknown {
  return JSON.parse(String(request?.init?.body));
}

/** Sends the clients' relative `fetch` calls through the stack's real HTTP app. */
export function routeFetchToStack(stack: TestStack): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    stack.app.request(String(input), init)) as typeof fetch;
}

export function stubOfflineFetch(): void {
  stubFetch(() => {
    throw new TypeError("offline");
  });
}
