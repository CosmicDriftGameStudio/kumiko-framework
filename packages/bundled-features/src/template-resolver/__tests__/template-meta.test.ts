import { describe, expect, test } from "bun:test";
import { parseTemplateMeta, templateSlugSchema } from "../template-meta";

describe("parseTemplateMeta", () => {
  test("mail requires a subject", () => {
    expect(parseTemplateMeta("mail", undefined).ok).toBe(false);
    expect(parseTemplateMeta("mail", {}).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi" })).toEqual({
      ok: true,
      meta: { subject: "Hi" },
    });
  });

  test("subject and previewText reject line breaks (header injection)", () => {
    const result = parseTemplateMeta("mail", { subject: "Hi\r\nBcc: x@y.z" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("meta.subject");
    expect(parseTemplateMeta("mail", { subject: "ok", previewText: "a\nb" }).ok).toBe(false);
  });

  test("unknown keys and bad category are rejected", () => {
    expect(parseTemplateMeta("mail", { subject: "Hi", extra: 1 }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi", category: "spam" }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi", category: "marketing" }).ok).toBe(true);
  });

  test("layouts accept empty meta or none; other kinds take no meta", () => {
    expect(parseTemplateMeta("mail-layout", undefined)).toEqual({ ok: true, meta: null });
    expect(parseTemplateMeta("mail-layout", {})).toEqual({ ok: true, meta: {} });
    expect(parseTemplateMeta("mail-layout", { subject: "x" }).ok).toBe(false);
    expect(parseTemplateMeta("text-block", { subject: "x" }).ok).toBe(false);
    expect(parseTemplateMeta("text-block", undefined)).toEqual({ ok: true, meta: null });
  });
});

describe("templateSlugSchema", () => {
  test.each(["welcome", "billing:notify:invoice-sent", "a1-b2"])("accepts %s", (slug) => {
    expect(templateSlugSchema.safeParse(slug).success).toBe(true);
  });
  test.each(["Welcome", "a_b", "a::b", "-a", "a b", ""])("rejects %j", (slug) => {
    expect(templateSlugSchema.safeParse(slug).success).toBe(false);
  });
});
