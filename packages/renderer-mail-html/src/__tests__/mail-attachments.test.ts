import { describe, expect, test } from "bun:test";
import {
  MAX_EMAIL_ATTACHMENTS,
  MAX_RENDERED_PDF_VARIABLES_BYTES,
  sanitizePdfAttachmentFileName,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { buildRenderedPdfAttachments, combineMailAttachments } from "../mail-attachments";

const inlineRef = (index: number) => ({
  kind: "inline" as const,
  cid: `img${index}`,
  fileRefId: `i${index}`,
});
const fileRef = (index: number) => ({
  kind: "file" as const,
  fileRefId: `f${index}`,
  fileName: `a${index}.pdf`,
});
const pdfRef = (index: number) => ({
  kind: "rendered-pdf" as const,
  templateSlug: `invoice-${index}`,
  variables: {},
  fileName: `invoice-${index}.pdf`,
  locale: "de",
});

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe("combineMailAttachments", () => {
  test("puts inline images before files and files before rendered PDFs", () => {
    expect(combineMailAttachments("s", [inlineRef(1)], [fileRef(1)], [pdfRef(1)])).toEqual([
      inlineRef(1),
      fileRef(1),
      pdfRef(1),
    ]);
  });

  test("accepts exactly the limit", () => {
    const files = Array.from({ length: MAX_EMAIL_ATTACHMENTS - 1 }, (_, i) => fileRef(i));
    expect(combineMailAttachments("s", [inlineRef(1)], files, [])).toHaveLength(
      MAX_EMAIL_ATTACHMENTS,
    );
  });

  test("throws a RendererError naming the slug when inline plus files exceed the limit", () => {
    const files = Array.from({ length: MAX_EMAIL_ATTACHMENTS }, (_, i) => fileRef(i));
    const thrown = thrownBy(() => combineMailAttachments("invoice", [inlineRef(1)], files, []));
    expect(thrown).toBeInstanceOf(RendererError);
    expect((thrown as RendererError).message).toContain('"invoice"');
  });

  test("counts rendered PDFs toward the limit", () => {
    const files = Array.from({ length: MAX_EMAIL_ATTACHMENTS }, (_, i) => fileRef(i));
    const thrown = thrownBy(() => combineMailAttachments("invoice", [], files, [pdfRef(1)]));
    expect(thrown).toBeInstanceOf(RendererError);
  });
});

describe("buildRenderedPdfAttachments", () => {
  const link = {
    kind: "rendered-pdf" as const,
    templateSlug: "billing:invoice",
    fileName: "x.pdf",
  };

  test("hands the mail's variables and locale to every PDF and renders the name pattern", () => {
    const refs = buildRenderedPdfAttachments({
      slug: "mail",
      links: [{ ...link, fileName: "rechnung-{{number}}.pdf" }],
      variables: { number: "RE-1" },
      locale: "de",
      renderFileName: (pattern) => pattern.replace("{{number}}", "RE-1"),
    });
    expect(refs).toEqual([
      {
        kind: "rendered-pdf",
        templateSlug: "billing:invoice",
        variables: { number: "RE-1" },
        locale: "de",
        fileName: "rechnung-RE-1.pdf",
      },
    ]);
  });

  test("refuses variables above the byte limit and names the mail slug", () => {
    const thrown = thrownBy(() =>
      buildRenderedPdfAttachments({
        slug: "big-mail",
        links: [link],
        variables: { blob: "x".repeat(MAX_RENDERED_PDF_VARIABLES_BYTES) },
        locale: "de",
        renderFileName: (pattern) => pattern,
      }),
    );
    expect(thrown).toBeInstanceOf(RendererError);
    expect((thrown as RendererError).message).toContain('"big-mail"');
  });

  test("does not look at the variables when no PDF is linked", () => {
    expect(
      buildRenderedPdfAttachments({
        slug: "s",
        links: [],
        variables: { blob: "x".repeat(MAX_RENDERED_PDF_VARIABLES_BYTES) },
        locale: "de",
        renderFileName: (pattern) => pattern,
      }),
    ).toEqual([]);
  });
});

describe("sanitizePdfAttachmentFileName", () => {
  test("adds the extension and strips separators and control characters", () => {
    expect(sanitizePdfAttachmentFileName('a/b\\c"d;e..f', "invoice")).toBe("a-b-c-d-e-f.pdf");
    expect(sanitizePdfAttachmentFileName("Re\u0000ch\nnung", "invoice")).toBe("Rechnung.pdf");
  });

  test("falls back to the last slug segment when the name renders empty", () => {
    expect(sanitizePdfAttachmentFileName("  ", "billing:invoice")).toBe("invoice.pdf");
  });

  test("keeps the result within the file name limit including the extension", () => {
    expect(sanitizePdfAttachmentFileName("a".repeat(500), "invoice").length).toBe(200);
  });
});
