import { describe, expect, test } from "bun:test";
import { mailLayoutAppearance } from "../layout-appearance";
import {
  parseTemplateMeta,
  readMailLayoutMeta,
  readPdfTemplateMeta,
  templateSlugSchema,
} from "../template-meta";

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

  test("chip, tone and footer note are optional single lines", () => {
    const ok = parseTemplateMeta("mail", {
      subject: "S",
      headerChip: "{{eventLabel}}",
      tone: "warning",
      footerNote: "Du erhältst diese Mail, weil du abonniert hast.",
    });
    expect(ok.ok).toBe(true);
    expect(parseTemplateMeta("mail", { subject: "S", headerChip: "a\nb" }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "S", footerNote: "x".repeat(301) }).ok).toBe(false);
  });

  test("unknown keys and bad category are rejected", () => {
    expect(parseTemplateMeta("mail", { subject: "Hi", extra: 1 }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi", category: "spam" }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi", category: "marketing" }).ok).toBe(true);
  });

  test("the legacy sender key is dropped instead of rejected", () => {
    expect(parseTemplateMeta("mail", { subject: "Hi", sender: "kebab" })).toEqual({
      ok: true,
      meta: { subject: "Hi" },
    });
  });

  test("senderName and replyTo are accepted; line breaks and non-addresses are rejected", () => {
    expect(
      parseTemplateMeta("mail", {
        subject: "Hi",
        senderName: "Nordlicht Immobilien GmbH",
        replyTo: "buchhaltung@nordlicht-immobilien.de",
      }).ok,
    ).toBe(true);
    expect(parseTemplateMeta("mail", { subject: "Hi", senderName: "A\r\nBcc: x@y.z" }).ok).toBe(
      false,
    );
    expect(parseTemplateMeta("mail", { subject: "Hi", senderName: "x".repeat(81) }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi", replyTo: "not-an-address" }).ok).toBe(false);
    expect(parseTemplateMeta("mail", { subject: "Hi", replyTo: "a@b.de\r\nBcc: x@y.z" }).ok).toBe(
      false,
    );
  });

  test("layouts accept empty meta or none; other kinds take no meta", () => {
    expect(parseTemplateMeta("mail-layout", undefined)).toEqual({ ok: true, meta: null });
    expect(parseTemplateMeta("mail-layout", {})).toEqual({ ok: true, meta: {} });
    expect(parseTemplateMeta("mail-layout", { subject: "x" }).ok).toBe(false);
    expect(parseTemplateMeta("pdf-layout", { width: 600 }).ok).toBe(false);
    expect(parseTemplateMeta("text-block", { subject: "x" }).ok).toBe(false);
    expect(parseTemplateMeta("text-block", undefined)).toEqual({ ok: true, meta: null });
  });
});

describe("document-pdf meta", () => {
  const valid = {
    layoutSlug: "company-letter",
    pageFormat: "Letter",
    margins: { top: 20, right: 10, bottom: 20, left: 10.5 },
    fileName: "Rechnung-{{invoiceNumber}}.pdf",
    metadata: { title: "Rechnung", author: "ACME" },
  } as const;

  test("a full valid meta is accepted, no meta at all too", () => {
    expect(parseTemplateMeta("document-pdf", valid)).toEqual({ ok: true, meta: valid });
    expect(parseTemplateMeta("document-pdf", undefined)).toEqual({ ok: true, meta: null });
    expect(parseTemplateMeta("document-pdf", null)).toEqual({ ok: true, meta: null });
  });

  test("orientation, printBackground and layoutHeaderFooter are accepted", () => {
    const meta = {
      orientation: "landscape",
      printBackground: false,
      layoutHeaderFooter: false,
    } as const;
    expect(parseTemplateMeta("document-pdf", meta)).toEqual({ ok: true, meta });
    expect(readPdfTemplateMeta(meta)).toEqual(meta);
  });

  test.each([{ orientation: "diagonal" }, { printBackground: "yes" }, { layoutHeaderFooter: 0 }])(
    "invalid new field %j is rejected",
    (meta) => {
      expect(parseTemplateMeta("document-pdf", meta).ok).toBe(false);
    },
  );

  test("an unknown page format or key is rejected", () => {
    const format = parseTemplateMeta("document-pdf", { pageFormat: "A5" });
    expect(format.ok).toBe(false);
    if (!format.ok) expect(format.issues[0]?.path).toBe("meta.pageFormat");
    expect(parseTemplateMeta("document-pdf", { watermark: true }).ok).toBe(false);
    expect(parseTemplateMeta("document-pdf", { margins: { top: 1, middle: 2 } }).ok).toBe(false);
  });

  test.each(["a/b.pdf", "a\\b.pdf", "../x.pdf", 'a"b.pdf', "a;b.pdf", "", "a\nb.pdf"])(
    "fileName %j is rejected",
    (fileName) => {
      expect(parseTemplateMeta("document-pdf", { fileName }).ok).toBe(false);
    },
  );

  test("margins must be within 0..100 mm", () => {
    expect(parseTemplateMeta("document-pdf", { margins: { top: 100, left: 0 } }).ok).toBe(true);
    const tooBig = parseTemplateMeta("document-pdf", { margins: { top: 101 } });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.issues[0]?.path).toBe("meta.margins.top");
    expect(parseTemplateMeta("document-pdf", { margins: { left: -1 } }).ok).toBe(false);
  });

  test("readPdfTemplateMeta returns the parsed meta or null", () => {
    expect(readPdfTemplateMeta(null)).toBeNull();
    expect(readPdfTemplateMeta({ subject: "Hi" })).toBeNull();
    expect(readPdfTemplateMeta({ pageFormat: "A4" })).toEqual({ pageFormat: "A4" });
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

describe("mail layout appearance meta", () => {
  test("accepts every appearance field", () => {
    const meta = {
      width: 560,
      font: "serif",
      outerBackground: "#A0b1C2",
      accentLine: "branding",
      buttonStyle: "filled-square",
    } as const;
    expect(parseTemplateMeta("mail-layout", meta)).toEqual({ ok: true, meta });
  });

  test.each([
    { width: 601 },
    { font: "mono" },
    { outerBackground: "#fff" },
    { outerBackground: "#12345g" },
    { accentLine: "always" },
    { buttonStyle: "pill" },
    { unknown: 1 },
  ])("rejects %o with an issue under meta", (meta) => {
    const result = parseTemplateMeta("mail-layout", meta);
    expect(result.ok).toBe(false);
  });

  test("an invalid stored value reads as defaults", () => {
    expect(readMailLayoutMeta({ width: 999 })).toEqual({});
    expect(mailLayoutAppearance({ width: 999 })).toMatchObject({
      width: 600,
      outerBackground: "#f5f5f5",
      accentLine: false,
    });
  });
});
