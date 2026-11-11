import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PDF_LAYOUT_LOOK,
  isPdfLayoutLookValid,
  pdfLayoutLookOf,
  pdfLayoutMetaToSave,
  samePdfLayoutLook,
} from "../layout-meta.ts";

describe("pdf layout look", () => {
  test("an untouched layout stores nothing", () => {
    expect(pdfLayoutMetaToSave(pdfLayoutLookOf({}), {})).toEqual({});
  });

  test("stores only what differs from the defaults", () => {
    const look = {
      ...DEFAULT_PDF_LAYOUT_LOOK,
      fontFamily: "times",
      tableStyle: "grid",
      tableHeaderBackground: "#eeeeee",
      margins: { top: "", right: 20, bottom: "", left: 20 },
    } as const;
    expect(pdfLayoutMetaToSave(look, {})).toEqual({
      margins: { right: 20, left: 20 },
      fontFamily: "times",
      tableStyle: "grid",
      tableHeaderBackground: "#eeeeee",
    });
  });

  test("keeps a stored field even when it now equals the default", () => {
    const saved = pdfLayoutMetaToSave(DEFAULT_PDF_LAYOUT_LOOK, { fontFamily: "arial" });
    expect(saved).toEqual({ fontFamily: "arial" });
  });

  test("round-trips the stored meta", () => {
    const meta = { fontSizePt: 12, textColor: "#000000", margins: { top: 10 } };
    expect(pdfLayoutMetaToSave(pdfLayoutLookOf(meta), meta)).toEqual(meta);
    expect(samePdfLayoutLook(pdfLayoutLookOf(meta), pdfLayoutLookOf(meta))).toBe(true);
  });

  test("rejects colors, sizes and margins the schema would refuse", () => {
    expect(isPdfLayoutLookValid(DEFAULT_PDF_LAYOUT_LOOK)).toBe(true);
    expect(isPdfLayoutLookValid({ ...DEFAULT_PDF_LAYOUT_LOOK, textColor: "red" })).toBe(false);
    expect(isPdfLayoutLookValid({ ...DEFAULT_PDF_LAYOUT_LOOK, tableHeaderBackground: "#12" })).toBe(
      false,
    );
    expect(isPdfLayoutLookValid({ ...DEFAULT_PDF_LAYOUT_LOOK, fontSizePt: 5 })).toBe(false);
    expect(
      isPdfLayoutLookValid({
        ...DEFAULT_PDF_LAYOUT_LOOK,
        margins: { top: 101, right: "", bottom: "", left: "" },
      }),
    ).toBe(false);
  });
});

describe("pdf layout letter settings", () => {
  test("fold marks, line colour and first-page switches are stored only when they differ", () => {
    expect(
      pdfLayoutMetaToSave(
        {
          ...DEFAULT_PDF_LAYOUT_LOOK,
          foldMarks: "din-b",
          tableLineColor: "#336699",
          headerOnFirstPage: false,
        },
        {},
      ),
    ).toEqual({ foldMarks: "din-b", tableLineColor: "#336699", headerOnFirstPage: false });
  });

  test("round-trips the stored meta and keeps an explicit default", () => {
    const meta = {
      foldMarks: "din-a",
      footerOnFirstPage: false,
      tableLineColor: "#000000",
    } as const;
    expect(pdfLayoutMetaToSave(pdfLayoutLookOf(meta), meta)).toEqual(meta);
    expect(
      pdfLayoutMetaToSave(pdfLayoutLookOf({ headerOnFirstPage: true }), {
        headerOnFirstPage: true,
      }),
    ).toEqual({ headerOnFirstPage: true });
  });

  test("corner marks are stored only when on, or when already stored", () => {
    expect(pdfLayoutMetaToSave({ ...DEFAULT_PDF_LAYOUT_LOOK, cornerMarks: true }, {})).toEqual({
      cornerMarks: true,
    });
    expect(pdfLayoutMetaToSave(DEFAULT_PDF_LAYOUT_LOOK, {})).toEqual({});
    expect(
      pdfLayoutMetaToSave(pdfLayoutLookOf({ cornerMarks: false }), { cornerMarks: false }),
    ).toEqual({ cornerMarks: false });
  });

  test("rejects a table line colour the schema would refuse", () => {
    expect(isPdfLayoutLookValid({ ...DEFAULT_PDF_LAYOUT_LOOK, tableLineColor: "blue" })).toBe(
      false,
    );
    expect(isPdfLayoutLookValid({ ...DEFAULT_PDF_LAYOUT_LOOK, tableLineColor: "#abcdef" })).toBe(
      true,
    );
  });
});
