// Sub-pipeline step-builders — branch + forEach.
//
// Both consume static StepInstance arrays as sub-pipelines (Q11) and
// share the build-time `validateNoReturnSteps` guard (Q12 — extracted
// to steps/_no-return-guard.ts). Tests cover happy paths, scope
// hygiene, error-propagation and build-time guards.

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { TestUsers } from "../../stack";
import { defineWriteHandler } from "../define-handler";
import { pipeline } from "../pipeline";
import { buildBranchStep } from "../steps/branch";
import { buildForEachStep } from "../steps/for-each";
import { buildReturnStep } from "../steps/return";
import { buildMinimalCtx } from "./_pipeline-test-utils";

describe("r.step.branch", () => {
  it("runs the `onTrue` array when the condition is truthy and writes propagate to outer steps", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:branch-then",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { value: number }>(({ r }) => [
        r.step.branch({
          if: () => true,
          onTrue: [r.step.compute("inThen", () => 42)],
          onFalse: [r.step.compute("inElse", () => -1)],
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { value: (steps["inThen"] as number | undefined) ?? 0 },
        })),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:branch-then", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) expect(result.data).toEqual({ value: 42 });
  });

  it("runs the `onFalse` array when the condition is falsy", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:branch-else",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { value: number }>(({ r }) => [
        r.step.branch({
          if: () => false,
          onTrue: [r.step.compute("inThen", () => 42)],
          onFalse: [r.step.compute("inElse", () => 99)],
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { value: (steps["inElse"] as number | undefined) ?? 0 },
        })),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:branch-else", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    if (result.isSuccess) expect(result.data).toEqual({ value: 99 });
  });

  it("is a no-op when the condition is falsy and `onFalse` is omitted", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:branch-noop",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ran: boolean }>(({ r }) => [
        r.step.branch({
          if: () => false,
          onTrue: [r.step.compute("ran", () => true)],
          // no onFalse
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { ran: (steps["ran"] as boolean | undefined) ?? false },
        })),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:branch-noop", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    if (result.isSuccess) expect(result.data).toEqual({ ran: false });
  });

  it("rejects r.step.return inside `onTrue` at build time (Q12 guard)", () => {
    expect(() =>
      buildBranchStep({
        if: () => true,
        onTrue: [buildReturnStep(() => ({ isSuccess: true as const, data: { x: 1 } }))],
      }),
    ).toThrow(/r\.step\.return is not allowed inside r\.step\.branch\.onTrue/);
  });

  it("rejects r.step.return inside `onFalse` at build time (Q12 guard)", () => {
    expect(() =>
      buildBranchStep({
        if: () => true,
        onTrue: [],
        onFalse: [buildReturnStep(() => ({ isSuccess: true as const, data: { x: 1 } }))],
      }),
    ).toThrow(/r\.step\.return is not allowed inside r\.step\.branch\.onFalse/);
  });
});

describe("r.step.forEach", () => {
  it("iterates the sub-pipeline once per item with scope[as] set", async () => {
    // Sub-pipeline reads scope[as] via a compute step that pushes
    // each iteration into a side-array. The side-array is the test
    // observable — proves the scope-key is set per-iteration.
    const observed: number[] = [];
    const handlerDef = defineWriteHandler({
      name: "demo:foreach",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.forEach({
          over: () => [10, 20, 30],
          as: "n",
          do: [
            r.step.compute("recorded", ({ scope }) => {
              observed.push(scope["n"] as number);
              return scope["n"];
            }),
          ],
        }),
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });

    await handlerDef.handler(
      { type: "demo:foreach", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(observed).toEqual([10, 20, 30]);
  });

  it("restores the prior scope-value (or deletes the key) after the loop", async () => {
    // Verifies forEach's scope-key isn't leaking after the loop by
    // inspecting steps from a downstream step. The contract: scope
    // is forEach-local — keys set inside don't survive past it.
    let scopeKeyAfter: unknown = "INITIAL";
    const handlerDef = defineWriteHandler({
      name: "demo:foreach-cleanup",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.forEach({
          over: () => [1],
          as: "tmp",
          do: [r.step.compute("noop", () => null)],
        }),
        r.step.compute("after", ({ scope }) => {
          scopeKeyAfter = scope["tmp"];
          return null;
        }),
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });

    await handlerDef.handler(
      { type: "demo:foreach-cleanup", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(scopeKeyAfter).toBeUndefined();
  });

  it("is a no-op for an empty array", async () => {
    let bodyRan = false;
    const handlerDef = defineWriteHandler({
      name: "demo:foreach-empty",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.forEach({
          over: () => [],
          as: "n",
          do: [
            r.step.compute("ranOnce", () => {
              bodyRan = true;
              return null;
            }),
          ],
        }),
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });

    await handlerDef.handler(
      { type: "demo:foreach-empty", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(bodyRan).toBe(false);
  });

  it("rejects r.step.return inside `do` at build time (Q12 guard)", () => {
    expect(() =>
      buildForEachStep({
        over: () => [],
        as: "x",
        do: [buildReturnStep(() => ({ isSuccess: true as const, data: {} }))],
      }),
    ).toThrow(/r\.step\.return is not allowed inside r\.step\.forEach\.do/);
  });

  it("rejects unsupported concurrency at build time (Q16: only 1 in M.1.6)", () => {
    // Cast (not @ts-expect-error) so the test stays valid when Q16
    // expands the type to accept N>1 — at that point this test should
    // delete or move under a Followup #12 build-validator suite, not
    // silently break for unrelated reasons.
    expect(() =>
      buildForEachStep({
        over: () => [],
        as: "x",
        do: [],
        concurrency: 5 as 1,
      }),
    ).toThrow(/concurrency=5 not supported in M\.1\.6/);
  });

  it("propagates a thrown error from a sub-step (try/finally restores scope)", async () => {
    let postForEachRan = false;
    const handlerDef = defineWriteHandler({
      name: "demo:foreach-throws",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, never>(({ r }) => [
        r.step.forEach({
          over: () => [1, 2, 3],
          as: "item",
          do: [
            r.step.compute("check", ({ scope }) => {
              if (scope["item"] === 2) throw new Error("item-2-bang");
              return null;
            }),
          ],
        }),
        r.step.compute("after", () => {
          postForEachRan = true;
          return null;
        }),
        r.step.return({ isSuccess: true as const, data: undefined as never }),
      ]),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:foreach-throws", payload: {}, user: TestUsers.admin },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/item-2-bang/);
    expect(postForEachRan).toBe(false);
  });

  it("throws when the over-resolver returns a non-array at runtime", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:foreach-bad-over",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.forEach({
          // Cast: TypeScript would normally catch this; the test exercises
          // the runtime guard for hand-crafted / dynamically built cases.
          over: (() => "not an array") as unknown as () => readonly never[],
          as: "x",
          do: [],
        }),
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:foreach-bad-over", payload: {}, user: TestUsers.admin },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/'over' resolver must return an array/);
  });
});
