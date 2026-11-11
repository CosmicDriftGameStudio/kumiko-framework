import { describe, expect, test } from "bun:test";
import {
  CONTENT_EDITOR_ELEMENT_ID,
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { sanitizeDocumentHtml } from "../../document-sanitizer.ts";
import DocumentTiptapEditor from "../document-tiptap-editor.tsx";
import { type DocumentEditorProps, PDF_DOCUMENT_BLOCKS } from "../document-toolbar-blocks.ts";
import { defaultTranslations } from "../i18n.ts";

const VARIABLES = ["invoice.number", "lines", "page"];
const VARIABLE_LABELS = { lines: "Invoice lines" };
const localeResolver = createStaticLocaleResolver({ locale: "en" });

function Controlled(props: Partial<Omit<DocumentEditorProps, "readOnly">>): ReactNode {
  const [value, setValue] = useState("");
  return (
    <LocaleProvider
      resolver={localeResolver}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>
        <DocumentTiptapEditor
          id={CONTENT_EDITOR_ELEMENT_ID}
          value={value}
          onChange={setValue}
          variables={VARIABLES}
          readOnly={false}
          blocks={PDF_DOCUMENT_BLOCKS}
          {...props}
        />
        <output data-testid="html">{value}</output>
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

async function renderEditor(props: Partial<DocumentEditorProps> = {}): Promise<void> {
  render(<Controlled {...props} />);
  await screen.findByRole("button", { name: "Bold" });
}

function currentHtml(): string {
  return screen.getByTestId("html").textContent ?? "";
}

async function click(name: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name }));
}

describe("DocumentTiptapEditor designer surface", () => {
  test("align sets data-align on the paragraph", async () => {
    await renderEditor();
    await click("Align");
    await click("Centered");
    await waitFor(() => expect(currentHtml()).toContain('data-align="center"'));
    expect(sanitizeDocumentHtml(currentHtml())).toEqual({ ok: true, html: currentHtml() });
  });

  test("repeat strip toggles the header row repeat", async () => {
    await renderEditor({
      variableLabels: VARIABLE_LABELS,
      chrome: "canvas",
      value: '<table><tbody><tr data-each="lines"><td><p>Position</p></td></tr></tbody></table>',
    });
    const bar = await screen.findByTestId("document-repeat-strip");
    expect(bar.textContent).not.toContain("Keep rows together");
    fireEvent.click(await screen.findByTestId("document-repeat-header-toggle"));
    await waitFor(() => expect(currentHtml()).toContain("data-repeat-header"));
    expect(sanitizeDocumentHtml(currentHtml())).toEqual({ ok: true, html: currentHtml() });
    fireEvent.click(await screen.findByTestId("document-repeat-header-toggle"));
    await waitFor(() => expect(currentHtml()).not.toContain("data-repeat-header"));
  });

  test("labelled variables show their label in pickers, chips and the steps head, the raw name as tooltip", async () => {
    await renderEditor({ variableLabels: VARIABLE_LABELS });
    await click("Placeholder");
    const chip = await screen.findByRole("button", { name: "Insert Invoice lines" });
    expect(chip.textContent).toBe("Invoice lines");
    expect(chip.getAttribute("title")).toBe("lines");
    expect(screen.getByRole("button", { name: "Insert invoice.number" }).textContent).toBe(
      "{{invoice.number}}",
    );
    fireEvent.click(chip);
    await waitFor(() => expect(currentHtml()).toContain('<span data-variable="lines"></span>'));
    const paperChip = document.querySelector("[data-variable-chip]");
    expect(paperChip?.firstChild?.textContent).toBe("Invoice lines");
    expect(paperChip?.getAttribute("title")).toBe("lines");

    await click("Steps");
    const stepsSelect = `${CONTENT_EDITOR_ELEMENT_ID}-panel-steps-variable`;
    fireEvent.click(await screen.findByTestId(`combobox-${stepsSelect}`));
    const option = await screen.findByTestId(`combobox-${stepsSelect}-option-lines`);
    expect(option.textContent).toContain("Invoice lines");
    fireEvent.click(option);
    await click("Insert");
    await waitFor(() => expect(currentHtml()).toContain('data-steps="lines"'));
    const stepsHead = document.querySelector("[data-steps], [data-document-block]");
    expect(stepsHead?.textContent).toContain("Steps · Invoice lines");
  });
});

describe("DocumentTiptapEditor table print controls", () => {
  const TABLE =
    "<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>";

  // The toolbar follows the caret: put it into the first cell the way a click would.
  async function placeCaretInFirstCell(): Promise<void> {
    const cell = await waitFor(() => {
      const found = document.querySelector("td p");
      if (found === null) throw new Error("table not rendered");
      return found;
    });
    const surface = document.querySelector<HTMLElement>(".ProseMirror");
    surface?.focus();
    window.getSelection()?.collapse(cell.firstChild ?? cell, 0);
    document.dispatchEvent(new Event("selectionchange"));
  }

  async function setNumber(testId: string, value: string): Promise<void> {
    fireEvent.change(await screen.findByTestId(testId), { target: { value } });
  }

  test("cell padding, width and alignment are written to the table and removed again", async () => {
    await renderEditor({ value: TABLE });
    await placeCaretInFirstCell();
    await setNumber("document-table-padding", "3");
    await setNumber("document-table-width", "120");
    fireEvent.click(await screen.findByTestId("document-table-align-center"));
    await waitFor(() => expect(currentHtml()).toContain('data-table-align="center"'));
    expect(currentHtml()).toContain('data-cell-padding-mm="3"');
    expect(currentHtml()).toContain('data-table-width-mm="120"');
    expect(sanitizeDocumentHtml(currentHtml())).toEqual({ ok: true, html: currentHtml() });
    fireEvent.click(await screen.findByTestId("document-table-align-center"));
    await waitFor(() => expect(currentHtml()).not.toContain("data-table-align"));
  });

  test("a row line is set per edge with colour and weight, and removed again", async () => {
    await renderEditor({ value: TABLE });
    await placeCaretInFirstCell();
    fireEvent.click(await screen.findByTestId("document-row-line-above"));
    await waitFor(() => expect(currentHtml()).toContain('data-line-above="#000000 0.5"'));
    await setNumber("document-row-line-above-weight", "2");
    await waitFor(() => expect(currentHtml()).toContain('data-line-above="#000000 2"'));
    fireEvent.change(screen.getByTestId("document-row-line-above-color"), {
      target: { value: "#336699" },
    });
    await waitFor(() => expect(currentHtml()).toContain('data-line-above="#336699 2"'));
    expect(sanitizeDocumentHtml(currentHtml())).toEqual({ ok: true, html: currentHtml() });
    fireEvent.click(await screen.findByTestId("document-row-line-above"));
    await waitFor(() => expect(currentHtml()).not.toContain("data-line-above"));
  });
});
