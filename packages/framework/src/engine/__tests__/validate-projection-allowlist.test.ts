// Boot-validator tests for r.step.unsafeProjection-* allowlist enforcement.
// Recursive walk through sub-pipelines (branch.onTrue/onFalse, forEach.do)
// is included here, plus the self-registration via defineStep({ subPaths })
// gate (Followup #15).

import { randomUUID } from "node:crypto";
import { table as pgTable, text, uuid } from "../../db/dialect";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { defineStep } from "../define-step";
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
              where: () => ({ id: "anything" }),
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
              where: () => ({ id: "anything" }),
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

  it("does NOT recurse into unregistered step-kind sub-arrays — defineStep is the registration gate (#15)", () => {
    // Pins the Followup #15 contract: walkAllSteps recurses ONLY into
    // sub-arrays whose step-kind is registered with `subPaths` via
    // defineStep. Hand-crafted instances with unregistered kinds are
    // walked as a single node — their nested arrays are invisible.
    // This is the SHAPE of the gate, demonstrated explicitly so the
    // contract is testable, not accidental.
    const featureWithUnknownSubBuilder = defineFeature("vproj-future-builder", (r) => {
      r.requires.projection("validate_demo_log");
      r.writeHandler(
        defineWriteHandler({
          name: "futureBuilder",
          schema: z.object({}),
          access: { roles: ["User"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            // Hand-crafted StepInstance simulating a future builder
            // whose kind isn't registered via defineStep yet.
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

    expect(() => validateProjectionAllowlist([featureWithUnknownSubBuilder])).not.toThrow();
  });

  it("DOES recurse into sub-arrays of step-kinds registered with subPaths via defineStep (#15)", () => {
    // Inverse of the previous test: when a NEW sub-step-builder
    // self-registers via defineStep({ subPaths: [...] }), the boot-
    // validator picks up the recursion automatically — no central
    // map to update. This is the value of self-registration.
    const futureKind = `test:future-builder:${randomUUID()}`;
    defineStep({
      kind: futureKind,
      defaultFailureStrategy: "throw",
      subPaths: ["children"],
      run: () => undefined,
    });

    const undeclaredTable = pgTable(`undeclared_${randomUUID().replace(/-/g, "")}`, {
      id: uuid("id").primaryKey().defaultRandom(),
      message: text("message").notNull(),
    });

    const feature = defineFeature(`vproj-future-builder-${randomUUID()}`, (r) => {
      // Note: NO r.requires.projection for the undeclared table.
      r.writeHandler(
        defineWriteHandler({
          name: "futureBuilder",
          schema: z.object({}),
          access: { roles: ["User"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            {
              kind: futureKind,
              args: {
                children: [
                  r.step.unsafeProjectionUpsert({
                    table: undeclaredTable,
                    on: ["id"],
                    row: () => ({ message: "deeply nested" }),
                  }),
                ],
              },
            },
            r.step.return({ isSuccess: true as const, data: { ok: true } }),
          ]),
        }),
      );
    });

    // Walker descended into `children` because the registered StepDef
    // declared it as a subPath, and the inner unsafeProjection trips
    // the allowlist check.
    expect(() => validateProjectionAllowlist([feature])).toThrow(
      /did not declare it via r\.requires\.projection/,
    );
  });

  it("rejects two features registering r.entity on the same table (#8)", () => {
    // Without this guard, the second r.entity() silently overwrites the
    // first in the validator's aggregate-tables map — and a later
    // unsafeProjection error against that table would name the WRONG
    // feature as owner. Surfacing the collision here names both parties.
    const featureA = defineFeature("dup-aggregate-a", (r) => {
      r.entity(
        "thing",
        createEntity({
          table: "shared_table",
          fields: { label: createTextField({ required: true }) },
        }),
      );
    });
    const featureB = defineFeature("dup-aggregate-b", (r) => {
      r.entity(
        "thing",
        createEntity({
          table: "shared_table",
          fields: { label: createTextField({ required: true }) },
        }),
      );
    });

    expect(() => validateProjectionAllowlist([featureA, featureB])).toThrow(
      /both feature "dup-aggregate-a" and feature "dup-aggregate-b"/,
    );
  });

  it("rejects use of a tier-2 step without r.requires.step(...) declaration (Q9)", () => {
    const sneakyFeature = defineFeature("step-discovery-missing", (r) => {
      // Note: NO r.requires.step("webhook.send")
      r.writeHandler(
        defineWriteHandler({
          name: "sneak",
          schema: z.object({}),
          access: { roles: ["Admin"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            r.step.webhook.send({
              url: "https://hooks.example/sneak",
              mode: "deferred",
              body: () => ({}),
            }),
            r.step.return({ isSuccess: true as const, data: { ok: true } }),
          ]),
        }),
      );
    });

    expect(() => validateProjectionAllowlist([sneakyFeature])).toThrow(
      /did not declare it via r\.requires\.step\("webhook\.send"\)/,
    );
  });

  it("rejects mail.send without r.requires.step(...) declaration", () => {
    const sneakyMail = defineFeature("step-discovery-mail-missing", (r) => {
      r.writeHandler(
        defineWriteHandler({
          name: "sneak",
          schema: z.object({}),
          access: { roles: ["Admin"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            r.step.mail.send({
              to: "x@y.com",
              subject: "hi",
              body: "hello",
              mode: "deferred",
            }),
            r.step.return({ isSuccess: true as const, data: { ok: true } }),
          ]),
        }),
      );
    });
    expect(() => validateProjectionAllowlist([sneakyMail])).toThrow(
      /did not declare it via r\.requires\.step\("mail\.send"\)/,
    );
  });

  it("rejects callFeature without r.requires.step(...) declaration", () => {
    const sneakyCall = defineFeature("step-discovery-call-missing", (r) => {
      r.writeHandler(
        defineWriteHandler({
          name: "sneak",
          schema: z.object({}),
          access: { roles: ["Admin"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            r.step.callFeature("subResult", {
              handler: "other:write:do",
              payload: () => ({}),
            }),
            r.step.return({ isSuccess: true as const, data: { ok: true } }),
          ]),
        }),
      );
    });
    expect(() => validateProjectionAllowlist([sneakyCall])).toThrow(
      /did not declare it via r\.requires\.step\("callFeature"\)/,
    );
  });

  it("accepts a tier-2 step when r.requires.step(...) is declared", () => {
    const happyFeature = defineFeature("step-discovery-happy", (r) => {
      r.requires.step("webhook.send");
      r.writeHandler(
        defineWriteHandler({
          name: "ok",
          schema: z.object({}),
          access: { roles: ["Admin"] },
          perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
            r.step.webhook.send({
              url: "https://hooks.example/ok",
              mode: "deferred",
              body: () => ({}),
            }),
            r.step.return({ isSuccess: true as const, data: { ok: true } }),
          ]),
        }),
      );
    });
    expect(() => validateProjectionAllowlist([happyFeature])).not.toThrow();
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
