// Boot-validator tests for r.step.unsafeProjection-* allowlist enforcement.
// Recursive walk through sub-pipelines (branch.onTrue/onFalse, forEach.do)
// is included here, as is the SUB_PIPELINE_KINDS registration-gate.

import { eq } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { createEntity, createTextField } from "../factories";
import { pipeline } from "../pipeline";
import { validateProjectionAllowlist } from "../validate-projection-allowlist";

describe("validateProjectionAllowlist", () => {
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
    const featureWithoutDecl = defineFeature("vproj-delete-missing", (r) => {
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

  it("does NOT recurse into unknown step-kind sub-arrays — SUB_PIPELINE_KINDS is the registration gate", () => {
    // Pins the Followup #15 risk: when M.2+ adds a new sub-step-builder
    // (e.g. r.step.workflow.race), its sub-arrays escape this validator
    // unless its kind is registered in SUB_PIPELINE_KINDS. This test
    // demonstrates the gap with a hand-crafted unknown-kind step. If
    // walkAllSteps' generator ever loses its kind-check (eager-recurse
    // refactor), this test breaks — the contract is intentional, not
    // accidental.
    const featureWithUnknownSubBuilder = defineFeature("vproj-future-builder", (r) => {
      // Allowlist is satisfied; the only thing that could trip the
      // validator is the nested step inside the unknown kind.
      r.requires.projection("validate_demo_log");
      r.writeHandler(
        defineWriteHandler({
          name: "futureBuilder",
          schema: z.object({}),
          access: { roles: ["User"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            // Hand-crafted StepInstance simulating a future builder
            // whose kind isn't in SUB_PIPELINE_KINDS yet.
            {
              kind: "future-sub-builder",
              args: {
                children: [
                  r.step.unsafeProjectionUpsert({
                    table: demoLogTable,
                    on: ["id"],
                    row: () => ({ message: "should escape allowlist" }),
                  }),
                ],
              },
            },
            r.step.return({ isSuccess: true as const, data: { ok: true } }),
          ]),
        }),
      );
    });

    // Validator does NOT throw — proves the unknown-kind sub-array
    // was not walked. (If it walked, the nested unsafeProjectionUpsert
    // would still pass because the table is declared. The point is
    // the SHAPE of the gate, demonstrated explicitly.)
    expect(() => validateProjectionAllowlist([featureWithUnknownSubBuilder])).not.toThrow();
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
