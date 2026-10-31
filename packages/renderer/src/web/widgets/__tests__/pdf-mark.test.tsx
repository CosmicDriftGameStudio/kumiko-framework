import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { markTextLayer, mergeLineRects } from "../pdf-search.ts";

function textLayer(lines: readonly string[]): HTMLElement {
  const container = document.createElement("div");
  for (const line of lines) {
    const span = document.createElement("span");
    span.textContent = line;
    container.append(span);
  }
  return container;
}

function marked(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((mark) => mark.textContent ?? "");
}

describe("markTextLayer", () => {
  test("marks only the matched words, not the whole span, and the active one stronger", () => {
    const container = textLayer(["Die Kaution beträgt drei Monatsmieten", "Rückgabe der Kaution"]);
    markTextLayer(container, "kaution", 1);
    expect(marked(container, "mark.pdf-hit")).toEqual(["Kaution", "Kaution"]);
    expect(marked(container, "mark.pdf-hit-active")).toEqual(["Kaution"]);
    expect(container.querySelector(".pdf-hit-active")?.closest("span")?.textContent).toBe(
      "Rückgabe der Kaution",
    );
    expect(container.textContent).toBe("Die Kaution beträgt drei MonatsmietenRückgabe der Kaution");
  });

  test("marks a phrase across span boundaries exactly", () => {
    const container = textLayer([
      "(1) Die Kaution beträgt drei Nettokaltmieten, also 2.850,00 €. Sie ist in",
      "drei gleichen Raten zu zahlen.",
    ]);
    markTextLayer(container, "Sie ist in drei gleichen Raten", 0);
    expect(marked(container, "mark.pdf-hit")).toEqual(["Sie ist in", "drei gleichen Raten"]);
    expect(marked(container, "mark.pdf-hit-active")).toEqual(["Sie ist in", "drei gleichen Raten"]);
  });

  test("a new term replaces earlier marks and an empty term clears them", () => {
    const container = textLayer(["Heizung und Wasser"]);
    markTextLayer(container, "heizung", 0);
    markTextLayer(container, "wasser", null);
    expect(marked(container, "mark.pdf-hit")).toEqual(["Wasser"]);
    expect(marked(container, "mark.pdf-hit-active")).toEqual([]);
    markTextLayer(container, "", null);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Heizung und Wasser");
  });
});

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

describe("mergeLineRects", () => {
  test("fuses rects of one line across gaps and keeps separate lines apart", () => {
    expect(
      mergeLineRects([rect(100, 10, 140, 22), rect(10, 11, 50, 23), rect(10, 40, 60, 52)]),
    ).toEqual([rect(10, 10, 140, 23), rect(10, 40, 60, 52)]);
  });

  test("a single rect stays unchanged", () => {
    expect(mergeLineRects([rect(5, 5, 20, 15)])).toEqual([rect(5, 5, 20, 15)]);
  });
});

describe("hit bands", () => {
  const rectsByText: Record<string, DOMRect[]> = {
    Heizkosten: [new DOMRect(10, 10, 40, 12)],
    "120,00": [new DOMRect(120, 11, 30, 12)],
  };
  const originalClientRects = HTMLElement.prototype.getClientRects;
  const originalBoundingRect = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
    HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
      return (rectsByText[this.textContent ?? ""] ?? []) as unknown as DOMRectList;
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getClientRects = originalClientRects;
    HTMLElement.prototype.getBoundingClientRect = originalBoundingRect;
  });

  test("one match over several cells becomes one band across the gap", () => {
    const container = textLayer(["Heizkosten", "120,00"]);
    markTextLayer(container, "heizkosten 120,00", 0);
    const bands = [...container.querySelectorAll<HTMLElement>(".pdf-hit-band")];
    expect(bands).toHaveLength(1);
    expect(bands[0]?.classList.contains("pdf-hit-band-active")).toBe(true);
    expect(bands[0]?.style.left).toBe("5%");
    expect(bands[0]?.style.width).toBe("70%");
  });

  test("two separate matches on one line keep separate bands; re-marking replaces bands", () => {
    const container = textLayer(["Heizkosten", "120,00", "Heizkosten"]);
    markTextLayer(container, "heizkosten", null);
    expect(container.querySelectorAll(".pdf-hit-band")).toHaveLength(2);
    markTextLayer(container, "heizkosten", null);
    expect(container.querySelectorAll(".pdf-hit-band")).toHaveLength(2);
    markTextLayer(container, "", null);
    expect(container.querySelector(".pdf-hit-band")).toBeNull();
  });
});
