import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { JwtHelper } from "../../api/jwt";
import type { SessionUser } from "../../engine/types";
import { createRequestHelper } from "../request-helper";

const user: SessionUser = {
  id: "u1",
  tenantId: "t1",
  roles: ["member"],
};

function jwtStub() {
  const signed: unknown[] = [];
  const jwt = {
    sign: async (payload: unknown) => {
      signed.push(payload);
      return `j.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    },
  } as unknown as JwtHelper;
  return { jwt, signed };
}

function appRecording(handler: (c: { req: { json: () => Promise<unknown>; header: (n: string) => string | undefined } }) => Response | Promise<Response>) {
  const calls: { path: string; auth?: string; extraHeaders: Record<string, string | undefined> }[] = [];
  const app = new Hono();
  for (const path of ["/api/write", "/api/query", "/api/command", "/api/batch"]) {
    app.post(path, async (c) => {
      calls.push({
        path,
        auth: c.req.header("authorization"),
        extraHeaders: { "x-trace": c.req.header("x-trace") },
      });
      return handler({ req: { json: () => c.req.json(), header: (n) => c.req.header(n) } });
    });
  }
  return { app, calls };
}

describe("createRequestHelper", () => {
  test("writeOk posts JSON to /api/write and resolves the success data", async () => {
    const { app, calls } = appRecording(
      () => Response.json({ isSuccess: true, data: { written: true } }),
    );
    const { jwt } = jwtStub();
    const http = createRequestHelper(app, jwt);

    const data = await http.writeOk("todo.create", { title: "x" }, user);
    expect(data).toEqual({ written: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/write");
    expect(calls[0]!.auth).toMatch(/^Bearer j\./);
  });

  test("sessionCreator is consulted once per user and its sid reaches the jwt", async () => {
    let creations = 0;
    const { app } = appRecording(() => Response.json({ isSuccess: true, data: {} }));
    const { jwt, signed } = jwtStub();
    const http = createRequestHelper(app, jwt, {
      sessionCreator: async () => {
        creations += 1;
        return "sid-42";
      },
    });

    await http.writeOk("a.b", {}, user);
    await http.queryOk("c.d", {}, user);
    expect(creations).toBe(1);
    expect(signed).toHaveLength(2);
    expect(signed[0]).toMatchObject({ id: "u1", tenantId: "t1", sid: "sid-42" });
  });

  test("user-provided sid skips the sessionCreator entirely", async () => {
    const { app } = appRecording(() => Response.json({ isSuccess: true, data: {} }));
    const { jwt, signed } = jwtStub();
    let creations = 0;
    const http = createRequestHelper(app, jwt, {
      sessionCreator: async () => {
        creations += 1;
        throw new Error("must not be called");
      },
    });
    await http.writeOk("a.b", {}, { ...user, sid: "pre-set" });
    expect(creations).toBe(0);
    expect(signed[0]).toMatchObject({ sid: "pre-set" });
  });

  test("writeOk surfaces the formatted failure including cause details", async () => {
    const { app } = appRecording(() =>
      Response.json(
        {
          error: {
            code: "internal_error",
            details: { causeName: "DbError", causeMessage: "connection lost" },
          },
        },
        { status: 500 },
      ),
    );
    const http = createRequestHelper(app, jwtStub().jwt);
    expect(http.writeOk("todo.create", {}, user)).rejects.toThrow(
      'Expected write "todo.create" to succeed but got error: internal_error (DbError: connection lost)',
    );
  });

  test("queryErr returns the wire error plus http status, but throws on success", async () => {
    const failing = appRecording(() =>
      Response.json({ error: { code: "validation_failed", message: "nope" } }, { status: 400 }),
    );
    const http = createRequestHelper(failing.app, jwtStub().jwt);
    const err = await http.queryErr("q.type", {}, user);
    expect(err.code).toBe("validation_failed");
    expect(err.httpStatus).toBe(400);

    const succeeding = appRecording(() => Response.json({ isSuccess: true, data: {} }));
    const http2 = createRequestHelper(succeeding.app, jwtStub().jwt);
    expect(http2.queryErr("q.type", {}, user)).rejects.toThrow('Expected query "q.type" to fail but it succeeded');
  });

  test("batch posts the commands array unchanged to /api/batch", async () => {
    const bodies: unknown[] = [];
    const app = new Hono();
    app.post("/api/batch", async (c) => {
      bodies.push(await c.req.json());
      return Response.json({ isSuccess: true, data: [] });
    });
    const http = createRequestHelper(app, jwtStub().jwt);
    await http.batch(
      [
        { type: "a", payload: { x: 1 } },
        { type: "b", payload: {} },
      ],
      user,
      "req-9",
    );
    expect(bodies[0]).toEqual({
      commands: [
        { type: "a", payload: { x: 1 } },
        { type: "b", payload: {} },
      ],
      requestId: "req-9",
    });
  });

  test("extra headers are forwarded alongside the auth header", async () => {
    const { app, calls } = appRecording(() => Response.json({ isSuccess: true, data: {} }));
    const http = createRequestHelper(app, jwtStub().jwt);
    await http.writeWithHeaders("a.b", {}, user, { "x-trace": "tr-1" });
    expect(calls[0]!.extraHeaders["x-trace"]).toBe("tr-1");
    expect(calls[0]!.auth).toMatch(/^Bearer /);
  });
});
