// Cumulative unit tests for r.step.* steps and the pipeline runner.
//
// Scope: defineWriteHandler({ perform: pipeline(...) }) compiles to a
// callable handler; the runner executes step instances against a minimal
// ctx; r.requires.projection allowlist is enforced at boot. Real-stack
// equivalents (Postgres + JWT + HTTP) live in
// pipeline-handler.integration.ts.
//
// NOTE: file is a deliberate sammelpunkt across slices (return / compute /
// unsafeProjectionUpsert / boot-validation / step-registry guards) until
// step-vocabulary.md M.1-Followup #7 splits per-step files after M.1.5.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TestUsers } from "../../stack";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { defineStep } from "../define-step";
import { createEntity, createTextField } from "../factories";
import { pipeline } from "../pipeline";
import { buildBranchStep } from "../steps/branch";
import { buildForEachStep } from "../steps/for-each";
import { buildReturnStep } from "../steps/return";
import type { HandlerContext, WriteEvent } from "../types/handlers";
import { validateProjectionAllowlist } from "../validate-projection-allowlist";

function buildMinimalCtx(): HandlerContext {
  // The return-step doesn't read any ctx field — the runner needs an
  // object-shaped ctx but no surface beyond that. Real-ctx integration
  // is the job of pipeline-handler.integration.ts.
  return {} as HandlerContext;
}

describe("r.step.* (unit)", () => {
  it("compiles a perform-block into a callable handler that returns the resolver's WriteResult", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:noop",
      schema: z.object({ greeting: z.string() }),
      access: { roles: ["User"] },
      perform: pipeline<{ greeting: string }, { echoed: string }>(({ event, r }) => [
        r.step.return(() => ({
          isSuccess: true as const,
          data: { echoed: event.payload.greeting },
        })),
      ]),
    });

    expect(typeof handlerDef.handler).toBe("function");
    expect(handlerDef.perform).toBeDefined();
    expect(handlerDef.perform?.__kind).toBe("pipeline");

    const event: WriteEvent<{ greeting: string }> = {
      type: "demo:noop",
      payload: { greeting: "hello" },
      user: TestUsers.admin,
    };

    const result = await handlerDef.handler(event, buildMinimalCtx());
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ echoed: "hello" });
    }
  });

  it("supports a static (non-resolver) WriteResult passed to r.step.return", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:static",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ok: boolean }>(({ r }) => [
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:static", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result).toEqual({ isSuccess: true, data: { ok: true } });
  });

  it("preserves the free-form handler path unchanged", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:freeform",
      schema: z.object({ n: z.number() }),
      access: { roles: ["User"] },
      handler: async (event) => ({
        isSuccess: true as const,
        data: { doubled: event.payload.n * 2 },
      }),
    });

    expect(handlerDef.perform).toBeUndefined();

    const result = await handlerDef.handler(
      { type: "demo:freeform", payload: { n: 21 }, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ doubled: 42 });
    }
  });

  it("surfaces an explicit error when a pipeline ends without r.step.return", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:no-return",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, never>(() => []),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:no-return", payload: {}, user: TestUsers.admin },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/r\.step\.return/);
  });

  it("threads compute results into subsequent step resolvers via steps.<name>", async () => {
    // Multi-step pipeline: compute lands a value under steps.startedAt,
    // the return resolver reads it back. This is the smallest test
    // that proves the steps-accumulator works end-to-end — every later
    // tier-1 step (read.*, aggregate.*) relies on the same plumbing.
    const handlerDef = defineWriteHandler({
      name: "demo:thread",
      schema: z.object({ base: z.number() }),
      access: { roles: ["User"] },
      perform: pipeline<{ base: number }, { sum: number }>(({ event, r }) => [
        r.step.compute("offset", () => 10),
        r.step.compute("doubledBase", () => event.payload.base * 2),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: {
            sum: (steps["offset"] as number) + (steps["doubledBase"] as number),
          },
        })),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:thread", payload: { base: 5 }, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ sum: 20 });
    }
  });

  it("re-evaluates compute resolvers per pipeline run (not at build time)", async () => {
    // The pipeline closure runs once per handler-invocation, but compute
    // resolvers are part of step args and execute again on each call.
    // Verifies a counter-style derivation produces fresh values per call.
    let counter = 0;
    const handlerDef = defineWriteHandler({
      name: "demo:fresh",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { tick: number }>(({ r }) => [
        r.step.compute("tick", () => ++counter),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { tick: steps["tick"] as number },
        })),
      ]),
    });

    const a = await handlerDef.handler(
      { type: "demo:fresh", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    const b = await handlerDef.handler(
      { type: "demo:fresh", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    if (a.isSuccess && b.isSuccess) {
      expect(a.data.tick).toBe(1);
      expect(b.data.tick).toBe(2);
    }
  });

  describe("r.step.branch (M.1.6)", () => {
    it("runs the `then` array when the condition is truthy and writes propagate to outer steps", async () => {
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

    it("runs the `else` array when the condition is falsy", async () => {
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

    it("is a no-op when the condition is falsy and `else` is omitted", async () => {
      const handlerDef = defineWriteHandler({
        name: "demo:branch-noop",
        schema: z.object({}),
        access: { roles: ["User"] },
        perform: pipeline<Record<string, never>, { ran: boolean }>(({ r }) => [
          r.step.branch({
            if: () => false,
            onTrue: [r.step.compute("ran", () => true)],
            // no else
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

    it("rejects r.step.return inside `then` at build time (Q12 guard)", () => {
      // We can't easily TS-prevent return inside branch (would need
      // a SubStepBuilder Omit-type, M.1-Followup). Build-time runtime
      // guard catches authoring mistakes the same way.
      expect(() =>
        buildBranchStep({
          if: () => true,
          onTrue: [buildReturnStep(() => ({ isSuccess: true as const, data: { x: 1 } }))],
        }),
      ).toThrow(/r\.step\.return is not allowed inside r\.step\.branch\.onTrue/);
    });

    it("rejects r.step.return inside `else` at build time (Q12 guard)", () => {
      expect(() =>
        buildBranchStep({
          if: () => true,
          onTrue: [],
          onFalse: [buildReturnStep(() => ({ isSuccess: true as const, data: { x: 1 } }))],
        }),
      ).toThrow(/r\.step\.return is not allowed inside r\.step\.branch\.onFalse/);
    });
  });

  describe("r.step.forEach (M.1.6)", () => {
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
      // Outer compute writes a scope-like value via the steps map; we
      // verify forEach's scope-key isn't leaking after the loop by
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
            // After forEach, scope["tmp"] should be undefined again —
            // forEach restores or deletes its key on exit.
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

  it("rejects a step with an unknown kind at runtime", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:unknown-kind",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, never>(() => [
        // Hand-crafted instance with a kind that's never been registered —
        // simulates a typo in a future step-builder factory.
        { kind: "this-step-does-not-exist", args: {} },
      ]),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:unknown-kind", payload: {}, user: TestUsers.admin },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/Unknown step kind "this-step-does-not-exist"/);
  });

  describe("Boot-validation: r.requires.projection allowlist", () => {
    const demoLogTable = pgTable("validate_demo_log", {
      id: uuid("id").primaryKey().defaultRandom(),
      message: text("message").notNull(),
    });

    it("rejects unsafeProjectionUpsert on an undeclared table", () => {
      const featureWithMissingDeclaration = defineFeature("vproj-missing", (r) => {
        // Note: NO r.requires.projection("validate_demo_log") here.
        r.writeHandler(
          defineWriteHandler({
            name: "log",
            schema: z.object({ msg: z.string() }),
            access: { roles: ["User"] },
            perform: pipeline<{ msg: string }, { ok: true }>(({ event, r }) => [
              r.step.unsafeProjectionUpsert({
                table: demoLogTable,
                on: ["id"],
                row: () => ({ message: event.payload.msg }),
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([featureWithMissingDeclaration])).toThrow(
        /did not declare it via r\.requires\.projection\("validate_demo_log"\)/,
      );
    });

    it("rejects unsafeProjectionUpsert on an aggregate-table (registered via r.entity)", () => {
      // Feature A registers `widget` as an aggregate (with table "widgets").
      const ownerFeature = defineFeature("vproj-owner", (r) => {
        r.entity(
          "widget",
          createEntity({
            table: "widgets",
            fields: { label: createTextField({ required: true }) },
          }),
        );
      });

      // Feature B tries to upsert directly into the widgets table — bypassing
      // the aggregate-pipeline. Even with r.requires.projection it must fail.
      const trespasserFeature = defineFeature("vproj-trespasser", (r) => {
        r.requires.projection("widgets");
        const widgetsTable = pgTable("widgets", {
          id: uuid("id").primaryKey().defaultRandom(),
          label: text("label").notNull(),
        });
        r.writeHandler(
          defineWriteHandler({
            name: "sneaky",
            schema: z.object({}),
            access: { roles: ["User"] },
            perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
              r.step.unsafeProjectionUpsert({
                table: widgetsTable,
                on: ["id"],
                row: () => ({ label: "trespass" }),
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([ownerFeature, trespasserFeature])).toThrow(
        /aggregate-projection of feature "vproj-owner".*r\.step\.aggregate\.\*/s,
      );
    });

    it("rejects unsafeProjectionDelete on an aggregate-table (parallel to upsert case)", () => {
      // Both unsafe-projection-* steps share UNSAFE_PROJECTION_KINDS in
      // the validator. Verify the aggregate-table guard fires for delete
      // too — without this test, a future kind-set narrowing could break
      // delete's protection silently.
      const ownerFeature = defineFeature("vproj-delete-owner", (r) => {
        r.entity(
          "widget",
          createEntity({
            table: "widgets-delete",
            fields: { label: createTextField({ required: true }) },
          }),
        );
      });

      const trespasserFeature = defineFeature("vproj-delete-trespasser", (r) => {
        r.requires.projection("widgets-delete");
        const widgetsTable = pgTable("widgets-delete", {
          id: uuid("id").primaryKey().defaultRandom(),
          label: text("label").notNull(),
        });
        r.writeHandler(
          defineWriteHandler({
            name: "sneaky-delete",
            schema: z.object({}),
            access: { roles: ["User"] },
            perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
              r.step.unsafeProjectionDelete({
                table: widgetsTable,
                where: () => eq(widgetsTable.id, "anything"),
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([ownerFeature, trespasserFeature])).toThrow(
        /aggregate-projection of feature "vproj-delete-owner".*r\.step\.aggregate\.\*/s,
      );
    });

    it("rejects unsafeProjectionDelete on an undeclared table (same gate as upsert)", () => {
      // unsafeProjectionDelete shares the boot-allowlist with upsert —
      // same UNSAFE_PROJECTION_KINDS set. Verify the gate fires
      // identically.
      const featureWithoutDecl = defineFeature("vproj-delete-missing", (r) => {
        // Note: NO r.requires.projection("validate_demo_log") here.
        r.writeHandler(
          defineWriteHandler({
            name: "purge",
            schema: z.object({}),
            access: { roles: ["User"] },
            perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
              r.step.unsafeProjectionDelete({
                table: demoLogTable,
                where: () => eq(demoLogTable.id, "anything"),
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([featureWithoutDecl])).toThrow(
        /did not declare it via r\.requires\.projection\("validate_demo_log"\)/,
      );
    });

    it("walks into branch.onTrue to find unsafeProjection-* (Q17 recursive)", () => {
      // Without recursive walk, the allowlist gate would be bypassed by
      // wrapping the forbidden step in branch.onTrue — exactly the kind of
      // bypass that the unsafe-prefix is meant to make visible.
      const featureWithBranchedUnsafe = defineFeature("vproj-branched", (r) => {
        // No r.requires.projection — should still trip the validator.
        r.writeHandler(
          defineWriteHandler({
            name: "branchedWrite",
            schema: z.object({}),
            access: { roles: ["User"] },
            perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
              r.step.branch({
                if: () => true,
                onTrue: [
                  r.step.unsafeProjectionUpsert({
                    table: demoLogTable,
                    on: ["id"],
                    row: () => ({ message: "wrapped in branch" }),
                  }),
                ],
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([featureWithBranchedUnsafe])).toThrow(
        /did not declare it via r\.requires\.projection\("validate_demo_log"\)/,
      );
    });

    it("walks recursively through nested sub-pipelines (forEach.do containing branch.onTrue containing unsafeProjection)", () => {
      // Generator-depth coverage: if walkAllSteps' yield* gets removed
      // in a future refactor, top-level + one-level tests stay green
      // but nested patterns (very common: forEach with conditional
      // upsert-or-delete) silently bypass the allowlist.
      const featureWithNestedUnsafe = defineFeature("vproj-nested", (r) => {
        r.writeHandler(
          defineWriteHandler({
            name: "nestedWrite",
            schema: z.object({}),
            access: { roles: ["User"] },
            perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
              r.step.forEach({
                over: () => [],
                as: "item",
                do: [
                  r.step.branch({
                    if: () => true,
                    onTrue: [
                      r.step.unsafeProjectionUpsert({
                        table: demoLogTable,
                        on: ["id"],
                        row: () => ({ message: "deeply nested" }),
                      }),
                    ],
                  }),
                ],
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([featureWithNestedUnsafe])).toThrow(
        /did not declare it via r\.requires\.projection\("validate_demo_log"\)/,
      );
    });

    it("walks into forEach.do to find unsafeProjection-* (Q17 recursive)", () => {
      const featureWithLoopedUnsafe = defineFeature("vproj-looped", (r) => {
        r.writeHandler(
          defineWriteHandler({
            name: "loopedWrite",
            schema: z.object({}),
            access: { roles: ["User"] },
            perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
              r.step.forEach({
                over: () => [],
                as: "x",
                do: [
                  r.step.unsafeProjectionUpsert({
                    table: demoLogTable,
                    on: ["id"],
                    row: () => ({ message: "looped" }),
                  }),
                ],
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([featureWithLoopedUnsafe])).toThrow(
        /did not declare it via r\.requires\.projection\("validate_demo_log"\)/,
      );
    });

    it("accepts unsafeProjectionUpsert when the table is declared and not an aggregate", () => {
      const happyFeature = defineFeature("vproj-happy", (r) => {
        r.requires.projection("validate_demo_log");
        r.writeHandler(
          defineWriteHandler({
            name: "log",
            schema: z.object({ msg: z.string() }),
            access: { roles: ["User"] },
            perform: pipeline<{ msg: string }, { ok: true }>(({ event, r }) => [
              r.step.unsafeProjectionUpsert({
                table: demoLogTable,
                on: ["id"],
                row: () => ({ message: event.payload.msg }),
              }),
              r.step.return({ isSuccess: true as const, data: { ok: true } }),
            ]),
          }),
        );
      });

      expect(() => validateProjectionAllowlist([happyFeature])).not.toThrow();
    });
  });

  it("defineStep throws when the same kind is registered with a different definition", () => {
    // Unique-per-run kind so this test is safe under vitest --watch
    // (where the file may re-execute in the same process). Without the
    // unique-kind, the first defineStep call on the second run would
    // already throw against the registration left from the first run.
    const kind = `test-only:duplicate-guard:${randomUUID()}`;

    defineStep({ kind, defaultFailureStrategy: "throw", run: () => undefined });

    expect(() =>
      defineStep({ kind, defaultFailureStrategy: "throw", run: () => "different" }),
    ).toThrow(/already registered/);
  });
});
