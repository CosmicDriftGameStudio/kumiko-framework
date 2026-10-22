// Thin JSON-over-fetch client for the Dodo Payments REST API. All traffic goes
// through the injected `send`, which defaults to the SSRF-safe egress in
// feature.ts and is replaced by a mock in tests.

import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";

export type DodoSend = (url: string, init?: RequestInit) => Promise<Response>;

export type DodoRequest = {
  readonly method: "GET" | "POST" | "PATCH";
  /** Path segments interpolated into it must already be encodeURIComponent'ed. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

export type DodoTarget = { readonly baseUrl: string; readonly apiKey: string };

// Never carries the response body or the key: both can hold customer data or secrets.
export class DodoHttpError extends Error {
  readonly status: number;
  constructor(request: DodoRequest, status: number) {
    super(`subscription-dodo: ${request.method} ${request.path} failed with status ${status}`);
    this.name = "DodoHttpError";
    this.status = status;
  }
}

export function createDodoHttp(send: DodoSend) {
  return async (target: DodoTarget, request: DodoRequest): Promise<unknown> => {
    const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : "";
    const response = await send(`${target.baseUrl}${request.path}${query}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        Accept: "application/json",
        ...(request.body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
    });
    if (!response.ok) throw new DodoHttpError(request, response.status);
    const text = await response.text();
    return text.length === 0 ? null : parseJsonOrThrow<unknown>(text, "subscription-dodo response");
  };
}
