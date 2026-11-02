import { describe, expect, test } from "bun:test";
import { normalizeApiExample } from "../normalize.ts";

const A = "3f2b8c1e-5a7d-4e0b-9c3a-1d2e3f4a5b6c";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("normalizeApiExample", () => {
  const normalized = normalizeApiExample({
    request: {
      endpoint: "/api/write",
      body: { type: "ticketing:write:ticket:close", payload: { id: A }, requestId: B },
    },
    response: {
      status: 200,
      body: {
        isSuccess: true,
        data: {
          id: A,
          other: B,
          createdAt: "2025-03-04T05:06:07.123456Z",
          label: "kpat_sample_value",
        },
        timestamp: "2025-03-04T05:06:07Z",
        nextCursor: "opaque",
        note: `see ${A}`,
      },
    },
  });

  test("numbers uuids by first occurrence and keeps equal ids equal", () => {
    expect(normalized.request.body.payload).toEqual({ id: "00000000-0000-4000-8000-000000000001" });
    expect(normalized.response.body).toMatchObject({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        other: "00000000-0000-4000-8000-000000000002",
      },
      note: "see 00000000-0000-4000-8000-000000000001",
    });
  });

  test("fixes timestamps, request id, cursor and tokens", () => {
    expect(normalized.request.body.requestId).toBe("11111111-1111-4111-8111-111111111111");
    expect(normalized.response.body).toMatchObject({
      timestamp: "2026-01-15T09:30:00.000Z",
      nextCursor: "CURSOR",
      data: { createdAt: "2026-01-15T09:30:00.000Z", label: "kpat_EXAMPLE" },
    });
  });

  test("a null cursor stays null", () => {
    const result = normalizeApiExample({
      request: { endpoint: "/api/query", body: { type: "a:query:b:list", payload: {} } },
      response: { status: 200, body: { rows: [], nextCursor: null } },
    });
    expect(result.response.body).toEqual({ rows: [], nextCursor: null });
  });

  test("credentials in a payload never reach the recording", () => {
    const result = normalizeApiExample({
      request: {
        endpoint: "/api/write",
        body: {
          type: "a:write:token:create",
          payload: { name: "ci", currentPassword: "hunter2", mfaCode: "123456" },
        },
      },
      response: { status: 200, body: { isSuccess: true, data: { clientSecret: "s3cr3t" } } },
    });
    expect(result.request.body.payload).toEqual({
      name: "ci",
      currentPassword: "REDACTED",
      mfaCode: "REDACTED",
    });
    expect(result.response.body).toEqual({ isSuccess: true, data: { clientSecret: "REDACTED" } });
  });
});

describe("normalizeApiExample credential coverage", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";

  test("token-like keys are redacted, harmless counters are not", () => {
    const result = normalizeApiExample({
      request: { endpoint: "/api/write", body: { type: "a:write:b:c", payload: {} } },
      response: {
        status: 200,
        body: {
          isSuccess: true,
          data: {
            accessToken: "opaque-a",
            refreshToken: "opaque-b",
            apiKey: "k-1",
            api_key: "k-2",
            authorization: "Bearer abc",
            token: "opaque-c",
            credentials: "user:pass",
            tokenCount: 3,
            note: "visible",
          },
        },
      },
    });
    expect(result.response.body).toEqual({
      isSuccess: true,
      data: {
        accessToken: "REDACTED",
        refreshToken: "REDACTED",
        apiKey: "REDACTED",
        api_key: "REDACTED",
        authorization: "REDACTED",
        token: "REDACTED",
        credentials: "REDACTED",
        tokenCount: 3,
        note: "visible",
      },
    });
  });

  test("a JWT in an arbitrary string field is replaced", () => {
    const result = normalizeApiExample({
      request: { endpoint: "/api/write", body: { type: "a:write:b:c", payload: {} } },
      response: {
        status: 200,
        body: { isSuccess: true, data: { session: JWT, hint: `Bearer ${JWT}` } },
      },
    });
    const serialized = JSON.stringify(result.response.body);
    expect(serialized).not.toContain("c2lnbmF0dXJl");
    expect(serialized).toContain("eyJEXAMPLE.EXAMPLE.EXAMPLE");
  });
});
