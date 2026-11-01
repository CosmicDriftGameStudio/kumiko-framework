import { afterEach, describe, expect, test } from "bun:test";
import {
  jsonResponse,
  restoreFetch,
  sentBody,
  stubFetch,
  stubOfflineFetch,
} from "../../shared/__tests__/fetch-test-utils.ts";
import { submitToWaitlist } from "../static-submit.ts";

afterEach(restoreFetch);

describe("submitToWaitlist", () => {
  test("posts waitlist:write:submit with the honeypot and locale, dropping blank optional fields", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true, data: { kind: "submitted" } }));
    const result = await submitToWaitlist({
      name: "Ada",
      email: "ada@example.com",
      company: "  ",
      message: "Hello",
      locale: "de-DE",
      website: "",
    });
    expect(result).toEqual({ kind: "success", data: undefined });
    expect(seen[0]?.url).toBe("/api/write");
    expect(sentBody(seen[0])).toEqual({
      type: "waitlist:write:submit",
      payload: {
        name: "Ada",
        email: "ada@example.com",
        locale: "de-DE",
        message: "Hello",
        website: "",
      },
    });
    expect(seen[0]?.init?.headers).toMatchObject({ "X-Locale": "de-DE" });
  });

  test("reports a rejected submission as a failure", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          isSuccess: false,
          error: { code: "validation_error", details: { fields: [{ path: "email" }] } },
        },
        { status: 400 },
      ),
    );
    const result = await submitToWaitlist({ name: "A", email: "x", locale: "en" });
    expect(result).toMatchObject({ kind: "failure", reason: "validation_error" });
  });

  test("reports an unreachable server as the network failure", async () => {
    stubOfflineFetch();
    expect(await submitToWaitlist({ name: "A", email: "a@b.de", locale: "en" })).toEqual({
      kind: "failure",
      reason: "network",
    });
  });
});
