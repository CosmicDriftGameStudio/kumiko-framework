// Pins createRequestHelper against a real setupTestStack (buildServer + JWT),
// not the mock-Hono unit suite. Covers success, structured errors, batch, and
// extra-header forwarding — the paths every integration test relies on via
// stack.http.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../engine";
import { NotFoundError, UnprocessableError, writeFailure } from "../../errors";
import { setupTestStack, type TestStack } from "../test-stack";
import { TestUsers } from "../test-users";

let stack: TestStack;

const pingFeature = defineFeature("reqhelp", (r) => {
  r.writeHandler(
    "echo",
    z.object({ note: z.string().min(1) }),
    async (event) => ({
      isSuccess: true as const,
      data: { note: event.payload.note, userId: event.user.id },
    }),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "boom",
    z.object({}),
    async () =>
      writeFailure(new UnprocessableError("reqhelp-boom", { i18nKey: "errors.unprocessable" })),
    { access: { openToAll: true } },
  );

  r.queryHandler(
    "lookup",
    z.object({ id: z.string().min(1) }),
    async (query) => {
      if (query.payload.id === "missing") {
        throw new NotFoundError("thing", query.payload.id, { i18nKey: "errors.notFound" });
      }
      return { id: query.payload.id, ok: true };
    },
    { access: { openToAll: true } },
  );
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [pingFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("createRequestHelper via setupTestStack.http", () => {
  test("writeOk posts to /api/write and returns handler data", async () => {
    const data = await stack.http.writeOk<{ note: string; userId: string }>(
      "reqhelp:write:echo",
      { note: "hello" },
      TestUsers.admin,
    );
    expect(data).toEqual({ note: "hello", userId: TestUsers.admin.id });
  });

  test("queryOk posts to /api/query and returns handler data", async () => {
    const data = await stack.http.queryOk<{ id: string; ok: boolean }>(
      "reqhelp:query:lookup",
      { id: "abc" },
      TestUsers.admin,
    );
    expect(data).toEqual({ id: "abc", ok: true });
  });

  test("writeErr returns structured WriteErrorInfo with httpStatus", async () => {
    const err = await stack.http.writeErr("reqhelp:write:boom", {}, TestUsers.admin);
    expect(err.code).toBe("unprocessable");
    expect(err.httpStatus).toBe(422);
    expect(err.i18nKey).toBe("errors.unprocessable");
  });

  test("queryErr returns structured WriteErrorInfo for not-found", async () => {
    const err = await stack.http.queryErr(
      "reqhelp:query:lookup",
      { id: "missing" },
      TestUsers.admin,
    );
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });

  test("writeOk throws when the write fails (so suites cannot ignore failures)", async () => {
    await expect(stack.http.writeOk("reqhelp:write:boom", {}, TestUsers.admin)).rejects.toThrow(
      /reqhelp:write:boom/,
    );
  });

  test("batch posts commands and returns per-command results", async () => {
    const res = await stack.http.batch(
      [
        { type: "reqhelp:write:echo", payload: { note: "a" } },
        { type: "reqhelp:write:echo", payload: { note: "b" } },
      ],
      TestUsers.admin,
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      isSuccess?: boolean;
      results?: readonly { isSuccess?: boolean; data?: { note?: string } }[];
    };
    expect(body.isSuccess).toBe(true);
    expect(body.results?.map((r) => r.data?.note)).toEqual(["a", "b"]);
  });

  test("writeWithHeaders forwards extra headers alongside auth", async () => {
    const res = await stack.http.writeWithHeaders(
      "reqhelp:write:echo",
      { note: "hdr" },
      TestUsers.admin,
      { "X-Correlation-ID": "corr-42" },
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { isSuccess?: boolean; data?: { note?: string } };
    expect(body.isSuccess).toBe(true);
    expect(body.data?.note).toBe("hdr");
    expect(res.headers.get("X-Correlation-ID")).toBe("corr-42");
  });

  test("queryWithHeaders forwards extra headers alongside auth", async () => {
    const res = await stack.http.queryWithHeaders(
      "reqhelp:query:lookup",
      { id: "abc" },
      TestUsers.admin,
      { "X-Correlation-ID": "corr-query" },
    );
    expect(res.ok).toBe(true);
    expect(res.headers.get("X-Correlation-ID")).toBe("corr-query");
    const body = (await res.json()) as { data?: { id?: string; ok?: boolean } };
    expect(body.data).toEqual({ id: "abc", ok: true });
  });
});
