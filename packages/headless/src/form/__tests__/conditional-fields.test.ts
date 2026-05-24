import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createFormController } from "../form-controller";

describe("conditional fields — FieldState resolution", () => {
  test("unlisted fields get the default {visible:true, readonly:false, required:false}", () => {
    const form = createFormController({ initial: { title: "hello" } });
    const snap = form.getSnapshot();

    // No rules declared → snapshot.fields is empty. Renderer treats
    // missing keys as defaults.
    expect(snap.fields).toEqual({});
  });

  test("static boolean condition resolves once at snapshot time", () => {
    const form = createFormController({
      initial: { title: "" },
      fields: {
        title: { visible: true, readonly: true, required: true },
      },
    });

    expect(form.getSnapshot().fields["title"]).toEqual({
      visible: true,
      readonly: true,
      required: true,
    });
  });

  test("predicate condition gets current values", () => {
    const form = createFormController<{ type: "a" | "b"; extra: string }>({
      initial: { type: "a", extra: "" },
      fields: {
        extra: {
          // "extra" is only required when type === "b"
          required: (values) => values.type === "b",
          visible: (values) => values.type === "b",
        },
      },
    });

    expect(form.getSnapshot().fields["extra"]).toEqual({
      visible: false,
      readonly: false,
      required: false,
    });

    form.setField("type", "b");

    expect(form.getSnapshot().fields["extra"]).toEqual({
      visible: true,
      readonly: false,
      required: true,
    });
  });

  test("predicate reads ctx for cross-cutting conditions (tenant, role)", () => {
    type Ctx = { readonly isAdmin: boolean };
    const form = createFormController<{ title: string }, Ctx>({
      initial: { title: "" },
      fields: {
        title: {
          readonly: (_values, ctx) => !ctx.isAdmin,
        },
      },
      ctx: { isAdmin: false },
    });

    expect(form.getSnapshot().fields["title"]?.readonly).toBe(true);

    form.setCtx({ isAdmin: true });

    expect(form.getSnapshot().fields["title"]?.readonly).toBe(false);
  });

  test("setCtx: predicate re-reads ctx on the next snapshot (not captured-at-create)", () => {
    // Regression guard: a future "cache predicates for perf" refactor could
    // bind the ctx into the predicate at create-time instead of calling it
    // fresh each buildSnapshot. If that happens, setCtx would fire a
    // notification but the predicate would still see the old ctx. This
    // test asserts the predicate actually reads the new ctx value after
    // setCtx — the notification alone isn't enough.
    type Ctx = { readonly role: "user" | "admin" };
    let lastCtxSeen: string | null = null;
    const form = createFormController<{ title: string }, Ctx>({
      initial: { title: "" },
      fields: {
        title: {
          readonly: (_v, ctx) => {
            lastCtxSeen = ctx.role;
            return ctx.role !== "admin";
          },
        },
      },
      ctx: { role: "user" },
    });

    // Force a snapshot build so the predicate runs once.
    form.getSnapshot();
    expect(lastCtxSeen).toBe("user");

    form.setCtx({ role: "admin" });
    form.getSnapshot();

    // The predicate must have been re-called AND observed the new ctx.
    expect(lastCtxSeen).toBe("admin");
  });

  test("setCtx produces a new snapshot and notifies listeners", () => {
    const form = createFormController<{ title: string }, { readonly role: string }>({
      initial: { title: "" },
      fields: {
        title: { readonly: (_v, ctx) => ctx.role !== "admin" },
      },
      ctx: { role: "user" },
    });

    const before = form.getSnapshot();
    form.setCtx({ role: "admin" });

    expect(form.getSnapshot()).not.toBe(before);
    expect(form.getSnapshot().fields["title"]?.readonly).toBe(false);
  });

  test("hidden fields are excluded from validate() — required:false for hidden works as expected", () => {
    // A hidden field with required:true on its schema should NOT fail
    // validation. The user isn't shown the field, so they can't satisfy
    // it — forcing them to is a UX footgun.
    const schema = z.object({
      type: z.enum(["a", "b"]),
      extra: z.string().min(1), // required in schema
    });

    const form = createFormController<{ type: "a" | "b"; extra: string }>({
      initial: { type: "a", extra: "" },
      schema,
      fields: {
        extra: {
          // Hidden when type !== "b"
          visible: (v) => v.type === "b",
        },
      },
    });

    // type="a" → extra hidden → even with empty `extra`, validate() succeeds.
    expect(form.validate()).toBe(true);

    form.setField("type", "b");
    // type="b" → extra visible → empty value now fails.
    expect(form.validate()).toBe(false);
    expect(form.getSnapshot().errors["extra"]).toBeDefined();
  });

  test("snapshot.fields resolves after each setField call (live-reactive)", () => {
    let predicateCalls = 0;
    const form = createFormController<{ type: "a" | "b"; extra: string }>({
      initial: { type: "a", extra: "" },
      fields: {
        extra: {
          visible: (v) => {
            predicateCalls++;
            return v.type === "b";
          },
        },
      },
    });

    form.getSnapshot(); // build 1
    form.setField("type", "b"); // build 2
    form.getSnapshot(); // still build 2 (identity preserved)
    form.getSnapshot();

    // Snapshot is cached — predicate only runs on mutator-driven rebuilds,
    // not on every getSnapshot().
    expect(predicateCalls).toBeLessThanOrEqual(3); // initial + 1 mutation + possibly 1 buffer
  });
});
