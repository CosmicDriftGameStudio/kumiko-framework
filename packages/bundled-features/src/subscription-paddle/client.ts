// Thin JSON-over-fetch client for the Paddle Billing REST API. All traffic goes
// through the injected `send`, which defaults to the SSRF-safe egress in
// feature.ts and is replaced by a mock in tests.

import { parseJsonOrThrow, parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";

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

const paddleErrorBodySchema = z.object({ error: z.object({ type: z.string(), code: z.string() }) });
// Both values come from outside; anything beyond a plain identifier is dropped so
// no customer text reaches the logs.
const ERROR_IDENTIFIER = /^[a-z0-9_]{1,100}$/;

type PaddleErrorDetails = { readonly type?: string; readonly code?: string };

function paddleErrorDetails(bodyText: string): PaddleErrorDetails {
  const parsed = paddleErrorBodySchema.safeParse(parseJsonSafe<unknown>(bodyText, undefined));
  if (!parsed.success) return {};
  const { type, code } = parsed.data.error;
  return {
    ...(ERROR_IDENTIFIER.test(type) && { type }),
    ...(ERROR_IDENTIFIER.test(code) && { code }),
  };
}

// Carries only the status and Paddle's error type and code, never `detail`, the
// rest of the body or the key: they can hold customer data or secrets.
export class PaddleHttpError extends Error {
  readonly status: number;
  readonly paddleErrorType?: string;
  readonly paddleErrorCode?: string;
  constructor(request: PaddleRequest, status: number, details: PaddleErrorDetails = {}) {
    const suffix = [details.type && `type ${details.type}`, details.code && `code ${details.code}`]
      .filter(Boolean)
      .join(", ");
    super(
      `subscription-paddle: ${request.method} ${request.path} failed with status ${status}${suffix ? ` (${suffix})` : ""}`,
    );
    this.name = "PaddleHttpError";
    this.status = status;
    if (details.type) this.paddleErrorType = details.type;
    if (details.code) this.paddleErrorCode = details.code;
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
    const text = await response.text();
    if (!response.ok) throw new PaddleHttpError(request, response.status, paddleErrorDetails(text));
    return text.length === 0
      ? null
      : parseJsonOrThrow<unknown>(text, "subscription-paddle response");
  };
}
