// Thin JSON-over-fetch client for the Paddle Billing REST API. All traffic goes
// through the injected `send`, which defaults to the SSRF-safe egress in
// feature.ts and is replaced by a mock in tests.

import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";

export type PaddleSend = (url: string, init?: RequestInit) => Promise<Response>;

export type PaddleRequest = {
  readonly method: "GET" | "POST" | "PATCH";
  /** Path segments interpolated into it must already be encodeURIComponent'ed. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

export type PaddleTarget = { readonly baseUrl: string; readonly apiKey: string };

const PADDLE_API_VERSION = "1";

// Never carries the response body or the key: both can hold customer data or secrets.
export class PaddleHttpError extends Error {
  readonly status: number;
  constructor(request: PaddleRequest, status: number) {
    super(`subscription-paddle: ${request.method} ${request.path} failed with status ${status}`);
    this.name = "PaddleHttpError";
    this.status = status;
  }
}

export function createPaddleHttp(send: PaddleSend) {
  return async (target: PaddleTarget, request: PaddleRequest): Promise<unknown> => {
    const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : "";
    const response = await send(`${target.baseUrl}${request.path}${query}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Paddle-Version": PADDLE_API_VERSION,
      },
      ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
    });
    if (!response.ok) throw new PaddleHttpError(request, response.status);
    const text = await response.text();
    return text.length === 0
      ? null
      : parseJsonOrThrow<unknown>(text, "subscription-paddle response");
  };
}
