import { afterEach, describe, expect, test } from "bun:test";
import {
  jsonResponse,
  restoreFetch,
  sentBody,
  stubFetch,
} from "../../shared/__tests__/fetch-test-utils.ts";
import { keepAccount } from "../static-keep-account.ts";

afterEach(restoreFetch);

describe("keepAccount", () => {
  test("posts the token to tenant-inactivity:write:keep-account", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true, data: { kept: true } }));
    expect(await keepAccount("tok")).toEqual({ kind: "success", data: undefined });
    expect(sentBody(seen[0])).toEqual({
      type: "tenant-inactivity:write:keep-account",
      payload: { token: "tok" },
    });
  });

  test("an expired or replaced link is a failure with the handler's reason", async () => {
    stubFetch(() =>
      jsonResponse(
        { isSuccess: false, error: { code: "unprocessable", message: "invalid_or_expired_token" } },
        { status: 422 },
      ),
    );
    expect(await keepAccount("old")).toMatchObject({ kind: "failure", reason: "unprocessable" });
  });

  test("a rate limit carries the retry hint", async () => {
    stubFetch(() => new Response("{}", { status: 429, headers: { "Retry-After": "30" } }));
    expect(await keepAccount("tok")).toEqual({
      kind: "failure",
      reason: "rate_limited",
      retryAfterSeconds: 30,
    });
  });
});
