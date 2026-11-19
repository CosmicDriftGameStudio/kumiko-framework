// binaryBody signature routes: the body must reach the handler byte-exact and
// unread by verify(), with the route's own size cap.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import { binaryBodySignatureRoute, ExtraRouteRejection } from "../extra-route.ts";
import { buildServer } from "../server.ts";

const JWT_SECRET = "test-binary-body-secret-32-chars-min!!";
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOW_HEADER = "x-allow";

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const handlerRuns: string[] = [];

const uploadRoute = binaryBodySignatureRoute({
  method: "POST",
  path: "/binary/upload",
  entry: "signature",
  binaryBody: { maxBytes: MAX_BYTES },
  verify: async (request) => {
    if (request.headers[ALLOW_HEADER] !== "yes") {
      throw new ExtraRouteRejection(401, { error: "invalid_token" });
    }
    return { accepted: true };
  },
  handler: async (c) => {
    handlerRuns.push(c.req.path);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json({ size: bytes.byteLength, sha256: sha256Hex(bytes) });
  },
});

function nonUtf8Payload(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = [0xff, 0xfe, 0x80][i % 3] ?? 0;
  return bytes;
}

describe("extraRoutes: signature route with binaryBody", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [], extraRoutes: [uploadRoute] });
  });
  afterAll(() => stack.cleanup());

  test("a body over 1 MiB with non-UTF-8 bytes arrives byte-exact", async () => {
    const payload = nonUtf8Payload(2 * 1024 * 1024 + 7);
    const res = await stack.app.request("/binary/upload", {
      method: "POST",
      headers: { [ALLOW_HEADER]: "yes", "content-type": "application/octet-stream" },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: payload.byteLength, sha256: sha256Hex(payload) });
  });

  test("a body over maxBytes is rejected with 413", async () => {
    const payload = nonUtf8Payload(MAX_BYTES + 1);
    const res = await stack.app.request("/binary/upload", {
      method: "POST",
      headers: {
        [ALLOW_HEADER]: "yes",
        "content-type": "application/octet-stream",
        "content-length": String(payload.byteLength),
      },
      body: payload,
    });
    expect(res.status).toBe(413);
  });

  test("a rejecting verify() keeps the handler from running", async () => {
    handlerRuns.length = 0;
    const res = await stack.app.request("/binary/upload", {
      method: "POST",
      body: nonUtf8Payload(1024),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
    expect(handlerRuns).toEqual([]);
  });
});

describe("extraRoutes: binaryBody boot validation", () => {
  const registry = createRegistry([defineFeature("binary-body-probe", () => {})]);
  const build = (path: string, maxBytes: number) => () =>
    buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      extraRoutes: [
        binaryBodySignatureRoute({
          method: "POST",
          path,
          entry: "signature",
          binaryBody: { maxBytes },
          verify: async () => true,
          handler: async (c) => c.json({}),
        }),
      ],
    });

  test("binaryBody under /api/ throws at boot", () => {
    expect(build("/api/binary", 1024)).toThrow(/must not\s+declare binaryBody under "\/api\/"/);
  });

  test("a non-positive or fractional maxBytes throws at boot", () => {
    expect(build("/binary/zero", 0)).toThrow(/maxBytes must be a\s+safe integer >= 1/);
    expect(build("/binary/frac", 1.5)).toThrow(/maxBytes must be a\s+safe integer >= 1/);
  });

  test("a valid binaryBody route boots", () => {
    expect(build("/binary/ok", 1024)).not.toThrow();
  });
});
