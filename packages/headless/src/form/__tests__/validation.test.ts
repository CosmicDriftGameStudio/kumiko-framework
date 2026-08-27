import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import { createFormController } from "../form-controller";
import { groupIssuesByPath, zodErrorToFieldIssues } from "../zod-bridge";

describe("zodErrorToFieldIssues", () => {
  test("flattens zod issues to FieldIssue with dotted paths", () => {
    const schema = z.object({
      title: z.string().min(1),
      address: z.object({ city: z.string().min(1) }),
      tags: z.array(z.string().min(1)),
    });
    const result = schema.safeParse({ title: "", address: { city: "" }, tags: ["ok", ""] });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = zodErrorToFieldIssues(result.error);

    const paths = issues.map((i) => i.path).sort();
    expect(paths).toContain("title");
    expect(paths).toContain("address.city");
    expect(paths).toContain("tags.1");
  });

  test("top-level issues get path='(root)' — matches server zod-bridge", () => {
    const schema = z.object({ foo: z.string() });
    // Pass a non-object → zod raises an issue with path=[].
    const result = schema.safeParse("not-an-object");

    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = zodErrorToFieldIssues(result.error);

    expect(issues[0]?.path).toBe("(root)");
  });

  test("surfaces zod params (minimum/maximum/expected) under issue.params", () => {
    const schema = z.object({ count: z.number().min(10).max(100) });
    const result = schema.safeParse({ count: 3 });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = zodErrorToFieldIssues(result.error);

    expect(issues[0]?.params).toBeDefined();
    expect(issues[0]?.params?.["minimum"]).toBe(10);
  });

  test("custom issue with params.i18nKey overrides the mechanical errors.validation.custom key", () => {
    const schema = z.object({ name: z.string() }).superRefine((values, ctx) => {
      if (values.name === "") {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: '"name" is required.',
          params: { i18nKey: "kumiko.validation.required" },
        });
      }
    });
    const result = schema.safeParse({ name: "" });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = zodErrorToFieldIssues(result.error);

    expect(issues[0]?.i18nKey).toBe("kumiko.validation.required");
  });

  test("custom issue without params.i18nKey still falls back to errors.validation.custom", () => {
    const schema = z.object({ name: z.string() }).superRefine((values, ctx) => {
      if (values.name === "bad") {
        ctx.addIssue({ code: "custom", path: ["name"], message: "not allowed" });
      }
    });
    const result = schema.safeParse({ name: "bad" });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = zodErrorToFieldIssues(result.error);

    expect(issues[0]?.i18nKey).toBe("errors.validation.custom");
  });
});

describe("groupIssuesByPath", () => {
  test("groups multiple issues on the same path into one bucket", () => {
    const grouped = groupIssuesByPath([
      { path: "title", code: "too_small", i18nKey: "x" },
      { path: "title", code: "invalid_format", i18nKey: "x" },
      { path: "age", code: "invalid_type", i18nKey: "x" },
    ]);

    expect(grouped["title"]).toHaveLength(2);
    expect(grouped["age"]).toHaveLength(1);
  });
});

describe("createFormController — validate()", () => {
  test("without a schema: validate() is a no-op that returns true", () => {
    const form = createFormController({ initial: { title: "" } });
    const listener = mock();
    form.subscribe(listener);

    const ok = form.validate();

    expect(ok).toBe(true);
    expect(form.getSnapshot().errors).toEqual({});
    expect(listener).not.toHaveBeenCalled(); // no-op
  });

  test("with a schema: validate() runs it and populates errors on failure", () => {
    const schema = z.object({ title: z.string().min(3), age: z.number().int() });
    const form = createFormController({
      initial: { title: "a", age: 1.5 },
      schema,
    });

    const ok = form.validate();
    const snap = form.getSnapshot();

    expect(ok).toBe(false);
    expect(snap.errors["title"]).toBeDefined();
    expect(snap.errors["age"]).toBeDefined();
  });

  test("validate() returns true when values match the schema", () => {
    const schema = z.object({ title: z.string().min(1) });
    const form = createFormController({ initial: { title: "hello" }, schema });

    expect(form.validate()).toBe(true);
    expect(form.getSnapshot().errors).toEqual({});
  });

  test("validate() clears previous errors on subsequent success", () => {
    // Common flow: user submits, sees errors, fixes fields, hits validate
    // again — old errors must disappear.
    const schema = z.object({ title: z.string().min(3) });
    const form = createFormController({ initial: { title: "a" }, schema });

    form.validate();
    expect(form.getSnapshot().errors["title"]).toBeDefined();

    form.setField("title", "hello");
    form.validate();

    expect(form.getSnapshot().errors).toEqual({});
  });

  test("validate() with nested values: errors keyed by dotted path", () => {
    const schema = z.object({
      address: z.object({ city: z.string().min(1) }),
    });
    const form = createFormController({ initial: { address: { city: "" } }, schema });

    form.validate();

    expect(form.getSnapshot().errors["address.city"]).toBeDefined();
  });
});

describe("createFormController — validate(scope)", () => {
  test("scoped run reports only fields inside scope, drops issues outside it", () => {
    const schema = z.object({
      a: z.string().min(3),
      b: z.string().min(3),
    });
    const form = createFormController({ initial: { a: "x", b: "y" }, schema });

    const ok = form.validate(["a"]);
    const snap = form.getSnapshot();

    expect(ok).toBe(false);
    expect(snap.errors["a"]).toBeDefined();
    expect(snap.errors["b"]).toBeUndefined();
  });

  test("scoped run returns true when every field in scope is valid, even if fields outside scope are not", () => {
    const schema = z.object({
      a: z.string().min(1),
      b: z.string().min(3),
    });
    const form = createFormController({ initial: { a: "ok", b: "y" }, schema });

    const ok = form.validate(["a"]);

    expect(ok).toBe(true);
    expect(form.getSnapshot().errors).toEqual({});
  });

  test("nested scope path matches issue root segment (#1898)", () => {
    const schema = z.object({
      address: z.object({ city: z.string().min(1) }),
    });
    const form = createFormController({
      initial: { address: { city: "" } },
      schema,
    });
    expect(form.validate(["address.city"])).toBe(false);
    expect(form.getSnapshot().errors["address.city"]).toBeDefined();
  });

  // Hard rule (kumiko-framework#1885): an object-level .refine() issue has
  // path "(root)", which never matches a field name — every scoped
  // validate() call must ignore it, and only the unscoped final-submit
  // validate() may surface it. Otherwise a step-boundary check would block
  // a wizard step forever on an invariant no single step owns.
  describe("root-path .refine() issues", () => {
    const schema = z
      .object({
        start: z.string(),
        end: z.string(),
      })
      .refine((v) => v.end >= v.start, { message: "end must be >= start" });

    test("scoped validate() ignores the root issue regardless of which fields are in scope", () => {
      const form = createFormController({ initial: { start: "b", end: "a" }, schema });

      expect(form.validate(["start"])).toBe(true);
      expect(form.validate(["end"])).toBe(true);
      expect(form.validate(["start", "end"])).toBe(true);
      expect(form.getSnapshot().errors).toEqual({});
    });

    test("unscoped validate() (final submit) reports the root issue under '(root)'", () => {
      const form = createFormController({ initial: { start: "b", end: "a" }, schema });

      const ok = form.validate();

      expect(ok).toBe(false);
      expect(form.getSnapshot().errors["(root)"]).toBeDefined();
    });
  });

  test("hidden fields stay filtered in scoped mode even when the hidden field is itself in scope", () => {
    // Discriminating case: field `b` is both hidden AND inside `scope`, so
    // the assertion actually exercises the hidden-field filter — not just
    // the scope filter dropping an out-of-scope field.
    const schema = z.object({
      a: z.string().min(3),
      b: z.string().min(3),
    });
    const form = createFormController({
      initial: { a: "x", b: "y", showB: false },
      schema,
      fields: { b: { visible: (values) => values.showB } },
    });

    const ok = form.validate(["a", "b"]);
    const snap = form.getSnapshot();

    expect(ok).toBe(false);
    expect(snap.errors["a"]).toBeDefined();
    expect(snap.errors["b"]).toBeUndefined();
  });

  test("hidden fields stay filtered in unscoped mode (regression guard alongside the scoped case)", () => {
    const schema = z.object({
      a: z.string().min(3),
      b: z.string().min(3),
    });
    const form = createFormController({
      initial: { a: "x", b: "y", showB: false },
      schema,
      fields: { b: { visible: (values) => values.showB } },
    });

    const ok = form.validate();
    const snap = form.getSnapshot();

    expect(ok).toBe(false);
    expect(snap.errors["a"]).toBeDefined();
    expect(snap.errors["b"]).toBeUndefined();
  });
});
