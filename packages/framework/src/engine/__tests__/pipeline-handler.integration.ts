// M.1.1 dispatcher-integration test — proves the perform-as-pipeline path
// goes through the full real stack:
//   - r.writeHandler(definitionObj) accepts the new output shape
//   - boot-validation doesn't trip on the `perform` field
//   - dispatcher parses the payload (Zod schema) BEFORE invoking handler
//   - dispatcher checks access-rules BEFORE invoking handler
//   - dispatcher hands the handler a real HandlerContext (~30 fields)
//   - the compiled handler (defineWriteHandler-generated) runs the
//     pipeline-runner against that ctx
//   - r.step.return resolver receives the live event
//   - WriteResult lands on the HTTP caller
//   - a step that throws maps to a standard write-failure (500 +
//     internal_error) via the dispatcher's catch
//
// Compare to pipeline-vertical-slice.test.ts which uses an empty ctx
// mock — this test is the gate advisor flagged: real Postgres, real
// JWT, real HTTP.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { pipeline } from "../pipeline";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";

const echoSchema = z.object({ greeting: z.string() });

const echoHandler = defineWriteHandler({
  // Registry's qualify() prepends "<feature>:write:" — handler def-name
  // is the short form only.
  name: "echo",
  schema: echoSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof echoSchema>, { echoed: string; from: string }>(
    ({ event, r }) => [
      r.step.return(() => ({
        isSuccess: true as const,
        data: {
          echoed: event.payload.greeting,
          from: event.user.id,
        },
      })),
    ],
  ),
});

// Second handler whose pipeline throws — proves the dispatcher's catch
// maps step-thrown errors to the standard write-failure shape.
const explodeSchema = z.object({});
const explodeHandler = defineWriteHandler({
  name: "explode",
  schema: explodeSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof explodeSchema>, never>(({ r }) => [
    r.step.return(() => {
      throw new Error("boom");
    }),
  ]),
});

// Third handler exercises the multi-step path through the real
// dispatcher: compute lands a value under steps.<name>, return reads it.
// Threading verified in the unit-test against an empty ctx; this proves
// the same wiring holds with the dispatcher's full HandlerContext.
const compoundSchema = z.object({ base: z.number() });
const compoundHandler = defineWriteHandler({
  name: "compound",
  schema: compoundSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof compoundSchema>, { sum: number; userId: string }>(
    ({ event, r }) => [
      r.step.compute("offset", () => 100),
      r.step.compute("doubledBase", () => event.payload.base * 2),
      r.step.return(({ steps, event: e }) => ({
        isSuccess: true as const,
        data: {
          sum: (steps["offset"] as number) + (steps["doubledBase"] as number),
          userId: e.user.id,
        },
      })),
    ],
  ),
});

const demoPipelineFeature = defineFeature("demoPipeline", (r) => {
  r.writeHandler(echoHandler);
  r.writeHandler(explodeHandler);
  r.writeHandler(compoundHandler);
});

let stack: TestStack;
const admin = TestUsers.admin;

describe("defineWriteHandler({ perform: pipeline(...) }) — real dispatcher path", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [demoPipelineFeature] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("HTTP write call goes through dispatcher → pipeline-runner → r.step.return", async () => {
    const res = await stack.http.write(
      "demo-pipeline:write:echo",
      { greeting: "hallo welt" },
      admin,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { isSuccess: true; data: { echoed: string; from: string } };
    expect(body.isSuccess).toBe(true);
    expect(body.data).toEqual({
      echoed: "hallo welt",
      from: admin.id,
    });
  });

  test("dispatcher rejects the call when payload fails Zod validation (schema runs BEFORE pipeline)", async () => {
    // Pipeline-runner shouldn't even fire — the dispatcher's parse-stage
    // catches the type mismatch and returns a validation error.
    const res = await stack.http.write(
      "demo-pipeline:write:echo",
      // Intentional type-mismatch — stack.http.write accepts unknown
      // payload, the dispatcher's Zod parse rejects it with 400.
      { greeting: 42 },
      admin,
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("validation_error");
  });

  test("dispatcher rejects the call when the user lacks the handler's role (access runs BEFORE pipeline)", async () => {
    // Access-check is a different boundary than schema-validation —
    // verify it also fires before the pipeline is built/executed.
    // TestUsers.user has role "User", handler requires "Admin".
    const res = await stack.http.write(
      "demo-pipeline:write:echo",
      { greeting: "should not pass" },
      TestUsers.user,
    );
    expect(res.status).toBe(403);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("access_denied");
  });

  test("compute steps thread results through to the return-step's resolver via the real dispatcher ctx", async () => {
    const res = await stack.http.write(
      "demo-pipeline:write:compound",
      { base: 7 },
      admin,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      isSuccess: true;
      data: { sum: number; userId: string };
    };
    expect(body.isSuccess).toBe(true);
    // 100 (offset) + 14 (base * 2) = 114
    expect(body.data.sum).toBe(114);
    expect(body.data.userId).toBe(admin.id);
  });

  test("a step that throws maps to a standard write-failure (dispatcher catch)", async () => {
    // The pipeline-runner doesn't wrap step exceptions in M.1.1 (the
    // "throw" failure-strategy is the only one supported). The dispatcher
    // must catch and surface the error as a normal WriteFailure shape.
    const res = await stack.http.write("demo-pipeline:write:explode", {}, admin);
    expect(res.status).toBe(500);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("internal_error");
  });
});
