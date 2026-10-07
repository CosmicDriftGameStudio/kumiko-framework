import type { RateLimitError } from "@cosmicdrift/kumiko-framework/errors";

export function rateLimitedTextResponse(error: RateLimitError): Response {
  return new Response("rate limited", {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": String(error.details.retryAfterSeconds),
    },
  });
}
