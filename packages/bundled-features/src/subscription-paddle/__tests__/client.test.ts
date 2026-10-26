import { describe, expect, test } from "bun:test";
import { createPaddleHttp, PaddleHttpError } from "../client.ts";

const target = { baseUrl: "https://sandbox-api.paddle.com", apiKey: "test_key" };
const request = { method: "POST", path: "/transactions" } as const;

async function failureFor(status: number, body: string): Promise<PaddleHttpError> {
  const http = createPaddleHttp(async () => new Response(body, { status }));
  const error = await http(target, request).catch((caught: unknown) => caught);
  if (!(error instanceof PaddleHttpError)) throw new Error("expected a PaddleHttpError");
  return error;
}

describe("PaddleHttpError", () => {
  test("carries Paddle's error type and code but never the detail", async () => {
    const error = await failureFor(
      400,
      JSON.stringify({
        error: {
          type: "request_error",
          code: "transaction_checkout_url_domain_is_not_approved",
          detail: "Customer jane@example.com used an unapproved domain",
        },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.paddleErrorType).toBe("request_error");
    expect(error.paddleErrorCode).toBe("transaction_checkout_url_domain_is_not_approved");
    expect(error.message).toContain("request_error");
    expect(error.message).toContain("transaction_checkout_url_domain_is_not_approved");
    expect(error.message).not.toContain("jane@example.com");
    expect(error.message).not.toContain("detail");
  });

  test("drops type and code that are not plain identifiers", async () => {
    const error = await failureFor(
      400,
      JSON.stringify({ error: { type: "Jane Doe", code: "bad code with spaces" } }),
    );
    expect(error.paddleErrorType).toBeUndefined();
    expect(error.paddleErrorCode).toBeUndefined();
    expect(error.message).not.toContain("Jane");
  });

  test("a body that is not JSON leaves the fields unset", async () => {
    const error = await failureFor(502, "<html>bad gateway</html>");
    expect(error.status).toBe(502);
    expect(error.paddleErrorType).toBeUndefined();
    expect(error.paddleErrorCode).toBeUndefined();
    expect(error.message).not.toContain("html");
  });
});
