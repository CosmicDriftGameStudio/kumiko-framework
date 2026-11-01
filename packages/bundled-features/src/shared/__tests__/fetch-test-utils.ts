import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";

const originalFetch = globalThis.fetch;

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "document");
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

export type BrowserSession = { readonly authCookie: string; readonly csrfCookie: string };

/**
 * Sends the clients' relative `fetch` calls through the stack's real HTTP app.
 * With a session it behaves like a signed-in browser: the cookie jar rides on every
 * request and `document.cookie` exposes the CSRF cookie the clients echo as a header.
 */
export function routeFetchToStack(stack: TestStack, session?: BrowserSession): void {
  if (session) {
    Reflect.set(globalThis, "document", { cookie: `kumiko_csrf=${session.csrfCookie}` });
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    stack.app.request(String(input), {
      ...init,
      ...(session && {
        headers: {
          ...init?.headers,
          Cookie: `kumiko_auth=${session.authCookie}; kumiko_csrf=${session.csrfCookie}`,
        },
      }),
    })) as typeof fetch;
}

export function stubOfflineFetch(): void {
  stubFetch(() => {
    throw new TypeError("offline");
  });
}
