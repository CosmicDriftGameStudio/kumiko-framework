import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactElement, type ReactNode, Suspense } from "react";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { PdfViewer } from "../pdf-viewer.tsx";

// Stands in for pdf.js' TextLayer: writes the page's text items as spans, like the real layer.
class FakeTextLayer {
  constructor(private readonly options: { container: HTMLElement; textContentSource: string[] }) {}
  render(): Promise<void> {
    for (const text of this.options.textContentSource) {
      const span = document.createElement("span");
      span.textContent = text;
      this.options.container.append(span);
    }
    return Promise.resolve();
  }
  cancel(): void {}
}
mock.module("pdfjs-dist", () => ({ TextLayer: FakeTextLayer }));

function renderViewer(viewer: ReactNode): void {
  render(<Suspense fallback={null}>{viewer}</Suspense>);
}

const PAGE_TEXTS = [
  ["Techem Energy Services", "Heizkostenabrechnung"],
  ["Ergebnis je Nutzeinheit"],
  ["Heizung Whg. 3", "Heizung Whg. 4"],
];

// React's use() reads status/value off a settled thenable instead of suspending, so the viewer mounts synchronously.
function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled" as const, value });
}

// pdf.js itself is not loadable in happy-dom; the viewer only needs page geometry and text.
function fakeDocument(): PDFDocumentProxy {
  const pages = PAGE_TEXTS.map((items) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    getTextContent: async () => ({ items: items.map((str) => ({ str })) }),
    streamTextContent: () => items,
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  }));
  const document = {
    numPages: pages.length,
    getPage: (pageNumber: number) => settled(pages[pageNumber - 1]),
  };
  // test double for the pdf.js document proxy, which cannot be constructed without a real PDF
  return document as unknown as PDFDocumentProxy;
}

class IdleIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const originalObserver = globalThis.IntersectionObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;
const scrolledPages: string[] = [];
const scrolledHits: string[] = [];
const scrolledSheets: string[] = [];
const scrollOrder: string[] = [];

beforeEach(() => {
  scrolledPages.length = 0;
  scrolledHits.length = 0;
  scrolledSheets.length = 0;
  scrollOrder.length = 0;
  Object.assign(globalThis, { IntersectionObserver: IdleIntersectionObserver });
  Element.prototype.scrollIntoView = function scrollIntoView(
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ) {
    const block = typeof options === "object" ? (options.block ?? "") : "";
    const isHit = this.classList.contains("pdf-hit-active");
    scrollOrder.push(`${isHit ? "hit" : (this.getAttribute("data-pdf-page") ?? "sheet")}:${block}`);
    if (isHit) scrolledHits.push(this.textContent ?? "");
    const slot = this.closest("[data-pdf-page]");
    if (slot !== null && slot !== this)
      scrolledSheets.push(slot.getAttribute("data-pdf-page") ?? "");
    scrolledPages.push(this.getAttribute("data-pdf-page") ?? "");
  };
});

afterEach(() => {
  Object.assign(globalThis, { IntersectionObserver: originalObserver });
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("PdfViewer", () => {
  test("renders toolbar, thumbnail rail and one slot per page without rendering any page yet", async () => {
    const document = fakeDocument();
    renderViewer(<PdfViewer document={document} />);
    expect(await screen.findByTestId("pdf-toolbar")).toBeTruthy();
    expect(screen.getByLabelText("Page number")).toBeTruthy();
    expect(screen.getByText("of 3")).toBeTruthy();
    expect(screen.getByTestId("pdf-zoom").textContent).toBe("100 %");
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeTruthy();
    expect(screen.getByTestId("pdf-thumbnail-3")).toBeTruthy();
    expect(screen.getByTestId("pdf-page-2")).toBeTruthy();
    expect(screen.getByTestId("pdf-page-2").querySelector("canvas")).toBeNull();
  });

  test("a default viewer keeps its 480px floor", async () => {
    const document = fakeDocument();
    renderViewer(<PdfViewer document={document} />);
    expect((await screen.findByTestId("pdf-viewer")).className).toContain("min-h-[480px]");
  });

  test("fill drops the floor so the host layout sizes the viewer", async () => {
    const document = fakeDocument();
    renderViewer(<PdfViewer document={document} fill />);
    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer.className).not.toContain("min-h-[480px]");
    expect(viewer.className).toContain("min-h-0");
  });

  test("page input jumps to the page and reports it", async () => {
    const onPageChange = mock((_page: number) => {});
    renderViewer(<PdfViewer document={fakeDocument()} onPageChange={onPageChange} />);
    const input = await screen.findByLabelText("Page number");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scrolledPages).toContain("3");
    expect(onPageChange).toHaveBeenCalledWith(3);
    expect(screen.getByTestId("pdf-thumbnail-3").getAttribute("aria-current")).toBe("page");
  });

  test("an out-of-range page number is clamped", async () => {
    renderViewer(<PdfViewer document={fakeDocument()} />);
    const input = await screen.findByLabelText("Page number");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scrolledPages).toContain("3");
  });

  test("zoom buttons step the percentage", async () => {
    renderViewer(<PdfViewer document={fakeDocument()} />);
    await screen.findByTestId("pdf-toolbar");
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByTestId("pdf-zoom").textContent).toBe("125 %");
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(screen.getByTestId("pdf-zoom").textContent).toBe("75 %");
  });

  test("search counts matches across pages, steps through them and jumps to the page", async () => {
    renderViewer(<PdfViewer document={fakeDocument()} />);
    await screen.findByTestId("pdf-toolbar");
    fireEvent.click(screen.getByLabelText("Search in document"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "heizung" } });
    await waitFor(() =>
      expect(screen.getByTestId("pdf-match-count").textContent).toBe("Match 1 of 2"),
    );
    expect(scrolledPages).toContain("3");
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(screen.getByTestId("pdf-match-count").textContent).toBe("Match 2 of 2");
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(screen.getByTestId("pdf-match-count").textContent).toBe("Match 1 of 2");
  });

  test("a term without hits says so", async () => {
    renderViewer(<PdfViewer document={fakeDocument()} />);
    await screen.findByTestId("pdf-toolbar");
    fireEvent.click(screen.getByLabelText("Search in document"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Wasserschaden" } });
    await waitFor(() => expect(screen.getByTestId("pdf-match-count").textContent).toBe("No match"));
  });

  test("searchTerm opens the search on the first hit", async () => {
    renderViewer(<PdfViewer document={fakeDocument()} searchTerm="Nutzeinheit" />);
    await waitFor(() =>
      expect(screen.getByTestId("pdf-match-count").textContent).toBe("Match 1 of 1"),
    );
    expect(scrolledPages).toContain("2");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Nutzeinheit");
  });

  test("a controlled matchIndex scrolls to that hit and reports count and index", async () => {
    const onMatchesChange = mock((_info: { count: number; index: number }) => {});
    const view = (index: number): ReactElement => (
      <Suspense fallback={null}>
        <PdfViewer
          document={fakeDocument()}
          searchTerm="heiz"
          matchIndex={index}
          onMatchesChange={onMatchesChange}
          hideSearchBar
        />
      </Suspense>
    );
    const { rerender } = render(view(0));
    await waitFor(() => expect(onMatchesChange).toHaveBeenCalledWith({ count: 3, index: 0 }));
    expect(scrolledPages).toContain("1");
    expect(screen.queryByTestId("pdf-match-count")).toBeNull();
    expect(screen.queryByLabelText("Search in document")).toBeNull();
    scrolledPages.length = 0;
    rerender(view(2));
    await waitFor(() => expect(onMatchesChange).toHaveBeenCalledWith({ count: 3, index: 2 }));
    expect(scrolledPages).toContain("3");
  });

  test("pagesOnly shows the pages and the host-stepped hit without thumbnail rail and toolbar", async () => {
    const onMatchesChange = mock((_info: { count: number; index: number }) => {});
    renderViewer(
      <PdfViewer
        document={fakeDocument()}
        searchTerm="Whg. 4"
        matchIndex={0}
        onMatchesChange={onMatchesChange}
        pagesOnly
      />,
    );
    expect(await screen.findByTestId("pdf-page-3")).toBeTruthy();
    await waitFor(() => expect(onMatchesChange).toHaveBeenCalledWith({ count: 1, index: 0 }));
    expect(scrolledPages).toContain("3");
    expect(screen.queryByTestId("pdf-toolbar")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });

  test("pages share the pane width at 100% so fit-to-width can measure it, and only overflow when zoomed in", async () => {
    renderViewer(<PdfViewer document={fakeDocument()} />);
    const pages = await screen.findByTestId("pdf-pages");
    expect(pages.className).toContain("w-full");
    expect(pages.className).not.toContain("w-max");
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByTestId("pdf-pages").className).toContain("w-max");
  });

  test("the active hit's page top comes into view first, then the hit itself", async () => {
    // Without IntersectionObserver every slot counts as seen, so the pages render.
    Object.assign(globalThis, { IntersectionObserver: undefined });
    renderViewer(
      <PdfViewer document={fakeDocument()} searchTerm="Whg. 4" matchIndex={0} hideSearchBar />,
    );
    await waitFor(() => expect(scrolledHits).toEqual(["Whg. 4"]));
    const hitAt = scrollOrder.indexOf("hit:nearest");
    expect(scrollOrder[hitAt - 1]).toBe("sheet:start");
  });

  test("the opening page re-anchors once rendered, until the reader jumps elsewhere", async () => {
    Object.assign(globalThis, { IntersectionObserver: undefined });
    renderViewer(<PdfViewer document={fakeDocument()} initialPage={3} />);
    await waitFor(() => expect(scrolledSheets).toContain("3"));
    const input = screen.getByLabelText("Page number");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    scrolledSheets.length = 0;
    scrolledPages.length = 0;
    fireEvent.click(screen.getByLabelText("Zoom in"));
    await waitFor(() => expect(screen.getByTestId("pdf-zoom").textContent).toBe("125 %"));
    await screen.findByTestId("pdf-page-3");
    expect(scrolledSheets).not.toContain("3");
    expect(scrolledPages).not.toContain("3");
  });

  test("markTerm marks the passage, re-anchors its rendered page top and leaves the search closed but usable", async () => {
    Object.assign(globalThis, { IntersectionObserver: undefined });
    renderViewer(<PdfViewer document={fakeDocument()} markTerm="Whg. 4" initialPage={3} />);
    const page = await screen.findByTestId("pdf-page-3");
    await waitFor(() => expect(page.querySelector("mark.pdf-hit")?.textContent).toBe("Whg. 4"));
    expect(page.querySelector(".pdf-hit-active")).toBeNull();
    expect(scrolledHits).toEqual([]);
    expect(scrolledPages).toContain("3");
    await waitFor(() => expect(scrolledSheets).toContain("3"));
    expect(scrolledSheets).not.toContain("1");
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByLabelText("Search in document"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Nutzeinheit" } });
    await waitFor(() =>
      expect(screen.getByTestId("pdf-match-count").textContent).toBe("Match 1 of 1"),
    );
    await waitFor(() => expect(page.querySelector("mark.pdf-hit")).toBeNull());
  });
});
