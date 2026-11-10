import { describe, expect, test } from "bun:test";
import {
  FRAME_FLOW_GAP_MM,
  flattenAddressSenderLine,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { PRINT_CSS } from "../document-pdf.ts";
import { chromiumRegionHtml, layoutAppearanceCss, planFirstPage } from "../document-pdf-style.ts";

const regionOf = (layoutMeta: Parameters<typeof chromiumRegionHtml>[0]["layoutMeta"]) =>
  chromiumRegionHtml({
    regionHtml: "<table><tr><td>Firma</td><td>Seite</td></tr></table>",
    position: "header",
    marginLeftMm: 20,
    marginRightMm: 15,
    layoutMeta,
  });

describe("chromiumRegionHtml", () => {
  test("stretches tables to the full width so a right column sits at the margin", () => {
    expect(regionOf({})).toContain("table{width:100%;border-collapse:collapse}");
  });

  test("sizes a region like the body when the layout sets no font size", () => {
    expect(regionOf({})).toContain("font-size:10.5pt");
    expect(PRINT_CSS).toContain("font-size:10.5pt");
  });

  test.each(["arial", "times", "courier", "calibri", "cambria"] as const)(
    "keeps the region style attribute intact with font %s",
    (fontFamily) => {
      expect(regionOf({ fontFamily, fontSizePt: 10 })).toMatch(
        /<div style="[^"]*font-size:10pt[^"]*">/,
      );
    },
  );

  test("sets region paragraphs without margins, as the editor shows them", () => {
    expect(regionOf({})).toContain("p{margin:0;");
  });

  test("carries the alignment rules so an aligned header paragraph is not left-aligned", () => {
    const html = regionOf({});
    expect(html).toContain("[data-align=center]{text-align:center}");
    expect(html).toContain("[data-align=right]{text-align:right}");
    expect(PRINT_CSS).toContain("[data-align=center]{text-align:center}");
  });

  test("uses the layout font size in pt when the layout sets one", () => {
    expect(regionOf({ fontSizePt: 10 })).toContain("font-size:10pt");
  });
});

const frameAt = (xMm: number) => ({
  xMm,
  yMm: 60,
  widthMm: 85,
  heightMm: 45,
  reserveFlow: true,
  preset: null,
});

describe("planFirstPage left edge", () => {
  test("a frame left of the layout margin moves the page margin out and pads the text back", () => {
    const plan = planFirstPage([frameAt(20)], 20, 26);
    expect(plan.pageLeftMm).toBe(20);
    expect(plan.css).toContain("--page-margin-left:20mm");
    expect(plan.css).toContain("body{padding-left:6mm}");
  });

  test("the layout's left margin is exposed for the address inset", () => {
    expect(planFirstPage([frameAt(20)], 20, 26).css).toContain("--paper-margin-left:26mm");
  });

  test("a frame right of the layout margin leaves the page margin and adds no padding", () => {
    const plan = planFirstPage([frameAt(30)], 20, 20);
    expect(plan.pageLeftMm).toBe(20);
    expect(plan.css).not.toContain("padding-left");
  });
});

describe("planFirstPage flow gap", () => {
  test("the flow starts the shared gap below a reserving frame", () => {
    const plan = planFirstPage([frameAt(20)], 20, 20);
    expect(plan.flowHeightMm).toBe(60 + 45 + FRAME_FLOW_GAP_MM - 20);
  });
});

describe("flattenAddressSenderLine", () => {
  const frame = (inner: string) =>
    `<div class="kumiko-frame" data-frame-preset="address" data-x="20">${inner}</div>`;

  const small = (text: string) => `<span data-size-pt="7">${text}</span>`;

  test("joins a multi-line sender address and draws the line below it", () => {
    const html = frame(
      `<p>${small("Muster GmbH · Weg 1\n12345 Berlin")}</p><p>Empfaenger\nStrasse 2</p>`,
    );
    const flat = flattenAddressSenderLine(html);
    expect(flat).toContain(small("Muster GmbH · Weg 1 · 12345 Berlin"));
    expect(flat).toContain("border-bottom:1px solid");
    expect(flat).toContain("<p>Empfaenger\nStrasse 2</p>");
  });

  test("keeps tags and attributes intact when a line break sits next to them", () => {
    const html = frame(
      `<p>${small("Muster GmbH\n")}<span\ndata-size-pt="7" title="a\nb">Weg 1</span></p>`,
    );
    const flat = flattenAddressSenderLine(html);
    expect(flat).toContain(`title="a\nb"`);
    expect(flat).toContain("Muster GmbH · ");
    expect(flat).not.toContain("<span ·");
    expect(flat).toContain("border-bottom:1px solid");
  });

  test("a recipient as first paragraph gets no line and keeps its line breaks", () => {
    const html = frame("<p>Empfaenger\nStrasse 2</p>");
    expect(flattenAddressSenderLine(html)).toBe(html);
  });

  test("leaves a text frame unchanged", () => {
    const html = '<div class="kumiko-frame" data-frame-preset="text"><p>a\nb</p></div>';
    expect(flattenAddressSenderLine(html)).toBe(html);
  });
});

describe("layoutAppearanceCss tableStyle header", () => {
  test("draws a line under the header cells only", () => {
    const css = layoutAppearanceCss({ tableStyle: "header" });
    expect(css).toContain("td,th{border:0}");
    expect(css).toContain("th{border-bottom:1px solid #bbb}");
    expect(css).not.toContain("td{border-bottom");
  });
});
