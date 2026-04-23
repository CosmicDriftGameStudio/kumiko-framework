import { describe, expect, test, vi } from "vitest";
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
    const listener = vi.fn();
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
