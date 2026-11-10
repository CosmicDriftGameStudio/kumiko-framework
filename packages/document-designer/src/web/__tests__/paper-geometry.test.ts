import { describe, expect, test } from "bun:test";
import { DEFAULT_PDF_FONT_SIZE_PT, DEFAULT_PDF_LAYOUT_LOOK } from "../layout-meta.ts";
import {
  EMPTY_MARGIN_INPUT,
  layoutRegionFlags,
  paperLookOf,
  paperSizeMm,
  paperVariables,
  paperWidthPt,
  percentOfExtent,
  resolveMarginsMm,
  rulerHalfMarks,
  rulerMarks,
} from "../paper-geometry.ts";

describe("paper size", () => {
  test("swaps width and height in landscape", () => {
    expect(paperSizeMm("A4", "portrait")).toEqual({ widthMm: 210, heightMm: 297 });
    expect(paperSizeMm("A4", "landscape")).toEqual({ widthMm: 297, heightMm: 210 });
  });

  test("converts the width to points", () => {
    expect(paperWidthPt(paperSizeMm("A4", "portrait"))).toBe(595.28);
  });
});

describe("resolveMarginsMm", () => {
  const none = { hasHeader: false, hasFooter: false };

  test("template wins over layout wins over the default, per side", () => {
    const margins = resolveMarginsMm({
      template: { ...EMPTY_MARGIN_INPUT, left: 25 },
      layout: { left: 30, top: 12 },
      ...none,
    });
    expect(margins).toEqual({ top: 12, right: 15, bottom: 15, left: 25 });
  });

  test("a layout header or footer raises the default margin of that side", () => {
    const margins = resolveMarginsMm({
      template: EMPTY_MARGIN_INPUT,
      layout: {},
      hasHeader: true,
      hasFooter: true,
    });
    expect(margins).toEqual({ top: 30, right: 15, bottom: 20, left: 15 });
  });

  test("an explicit zero margin is kept", () => {
    const margins = resolveMarginsMm({
      template: { ...EMPTY_MARGIN_INPUT, top: 0 },
      layout: { top: 12 },
      ...none,
    });
    expect(margins.top).toBe(0);
  });
});

describe("layoutRegionFlags", () => {
  const regions = { header: "<p>h</p>", signature: "", footer: " " };

  test("reports which regions carry content", () => {
    expect(layoutRegionFlags(true, regions)).toEqual({
      showRegions: true,
      hasHeader: true,
      hasFooter: false,
    });
  });

  test("shows nothing when the template opts out of the layout regions", () => {
    expect(layoutRegionFlags(false, regions).hasHeader).toBe(false);
    expect(layoutRegionFlags(true, null).showRegions).toBe(false);
  });
});

describe("ruler", () => {
  test("marks every full centimetre in percent of the extent", () => {
    const marks = rulerMarks(210);
    expect(marks).toHaveLength(20);
    expect(marks[0]).toEqual({ cm: 1, percent: percentOfExtent(10, 210) });
    expect(marks[19]?.percent).toBe(percentOfExtent(200, 210));
  });

  test("puts a fine tick at 5 mm between every two centimetre ticks", () => {
    const marks = rulerHalfMarks(210);
    expect(marks).toHaveLength(21);
    expect(marks[0]).toEqual({ mm: 5, percent: percentOfExtent(5, 210) });
    expect(marks[20]?.mm).toBe(205);
    expect(rulerHalfMarks(297).at(-1)?.mm).toBe(295);
    expect(rulerHalfMarks(3)).toEqual([]);
  });
});

describe("paperVariables", () => {
  const size = paperSizeMm("A4", "portrait");
  const margins = { top: 15, right: 20, bottom: 15, left: 20 };
  const look = paperLookOf(DEFAULT_PDF_LAYOUT_LOOK);

  test("scales mm and pt with the container width and zeroes the frame offsets", () => {
    const variables = paperVariables({ size, margins, look });
    expect(variables["--paper-mm"]).toBe("calc(100cqw / 210)");
    expect(variables["--paper-pt"]).toBe("calc(100cqw / 595.28)");
    expect(variables["--page-margin-left"]).toBe("0px");
    expect(variables["--first-page-top"]).toBe("0px");
    expect(variables["--page-margin-top-mm"]).toBe("15");
    expect(variables["--paper-margin-right"]).toBe("calc(20 * var(--paper-mm))");
  });

  test("falls back to the default size and drops colors that are still being typed", () => {
    const typed = paperLookOf({
      ...DEFAULT_PDF_LAYOUT_LOOK,
      fontSizePt: 400,
      textColor: "#12",
    });
    expect(typed.fontSizePt).toBe(DEFAULT_PDF_FONT_SIZE_PT);
    expect(typed.textColor).toBeNull();
  });
});
