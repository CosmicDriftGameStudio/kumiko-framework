import { describe, expect, test } from "bun:test";
import { markTextLayer } from "../pdf-search.ts";

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
