import { describe, expect, test } from "bun:test";
import {
  CONTENT_EDITOR_ELEMENT_ID,
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { sanitizeDocumentHtml } from "../../document-sanitizer.js";
import DocumentTiptapEditor from "../document-tiptap-editor.js";
import { type DocumentEditorProps, PDF_DOCUMENT_BLOCKS } from "../document-toolbar-blocks.js";
import { defaultTranslations } from "../i18n.js";

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

  test("repeat bar toggles the header row repeat", async () => {
    await renderEditor({ variableLabels: VARIABLE_LABELS });
    await click("Repeat");
    fireEvent.click(await screen.findByTestId(`combobox-${CONTENT_EDITOR_ELEMENT_ID}-panel-list`));
    fireEvent.click(
      await screen.findByTestId(`combobox-${CONTENT_EDITOR_ELEMENT_ID}-panel-list-option-lines`),
    );
    await click("Insert");
    await waitFor(() => expect(currentHtml()).toContain('<tr data-each="lines">'));
    const bar = await screen.findByTestId("document-repeat-bar");
    expect(bar.textContent).toContain("Repeat · Invoice lines");
    expect(bar.textContent).not.toContain("Keep rows together");
    await click("Repeat header row");
    await waitFor(() => expect(currentHtml()).toContain("data-repeat-header"));
    expect(sanitizeDocumentHtml(currentHtml())).toEqual({ ok: true, html: currentHtml() });
    await click("Repeat header row");
    await waitFor(() => expect(currentHtml()).not.toContain("data-repeat-header"));
  });
});
