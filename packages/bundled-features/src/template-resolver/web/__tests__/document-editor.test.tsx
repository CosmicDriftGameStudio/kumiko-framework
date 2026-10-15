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
import { type DocumentToolbarBlock, PDF_DOCUMENT_BLOCKS } from "../document-toolbar-blocks.js";
import { defaultTranslations } from "../i18n.js";

const VARIABLES = ["recipient.name", "invoice.url", "lines", "bad name"];
const localeResolver = createStaticLocaleResolver({ locale: "en" });

function Controlled({
  readOnly = false,
  blocks,
}: {
  readonly readOnly?: boolean;
  readonly blocks?: readonly DocumentToolbarBlock[];
}): ReactNode {
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
          readOnly={readOnly}
          {...(blocks !== undefined && { blocks })}
        />
        <output data-testid="html">{value}</output>
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

async function renderEditor(props: Parameters<typeof Controlled>[0] = {}): Promise<void> {
  render(<Controlled {...props} />);
  await screen.findByRole("button", { name: "Bold" });
}

function currentHtml(): string {
  return screen.getByTestId("html").textContent ?? "";
}

function expectCanonical(html: string): void {
  expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html });
}

async function click(name: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name }));
}

async function chooseOption(selectId: string, value: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`combobox-${selectId}`));
  fireEvent.click(await screen.findByTestId(`combobox-${selectId}-option-${value}`));
}

const PANEL = `${CONTENT_EDITOR_ELEMENT_ID}-panel`;

describe("DocumentTiptapEditor toolbar", () => {
  test("placeholder chip inserts a variable node, never {{ text", async () => {
    await renderEditor();
    await click("Placeholder");
    expect(screen.queryByRole("button", { name: /bad name/ })).toBeNull();
    await click("Insert recipient.name");
    await waitFor(() =>
      expect(currentHtml()).toContain('<span data-variable="recipient.name"></span>'),
    );
    expect(currentHtml()).not.toContain("{{");
    expectCanonical(currentHtml());
  });

  test("divider inserts an hr", async () => {
    await renderEditor();
    await click("Divider");
    await waitFor(() => expect(currentHtml()).toContain("<hr>"));
    expectCanonical(currentHtml());
  });

  test("button block targets a placeholder href", async () => {
    await renderEditor();
    await click("Button");
    await chooseOption(`${PANEL}-target`, "invoice.url");
    await click("Insert");
    await waitFor(() =>
      expect(currentHtml()).toContain('<a data-button="" href="{{invoice.url}}">Confirm</a>'),
    );
    expectCanonical(currentHtml());
  });

  test("repeat block creates a table with a data-each row", async () => {
    await renderEditor();
    await click("Repeat");
    await chooseOption(`${PANEL}-list`, "lines");
    await click("Insert");
    await waitFor(() => expect(currentHtml()).toContain('<tr data-each="lines">'));
    expectCanonical(currentHtml());
  });

  test("image block inserts a resource node", async () => {
    await renderEditor();
    await click("Image");
    fireEvent.change(screen.getByLabelText("Resource key"), { target: { value: "logo" } });
    await click("Insert");
    await waitFor(() => expect(currentHtml()).toContain('<img data-resource="logo"'));
    expectCanonical(currentHtml());
  });

  test("invalid resource key shows an error and inserts nothing", async () => {
    await renderEditor();
    await click("Image");
    fireEvent.change(screen.getByLabelText("Resource key"), { target: { value: "bad key!" } });
    await click("Insert");
    expect((await screen.findByRole("alert")).textContent).toBe("This resource key is not valid.");
    expect(currentHtml()).not.toContain("<img");
  });

  test("alt text with angle brackets shows an error and inserts nothing", async () => {
    await renderEditor();
    await click("Image");
    fireEvent.change(screen.getByLabelText("Resource key"), { target: { value: "logo" } });
    fireEvent.change(screen.getByLabelText("Alt text (optional)"), { target: { value: "a<b" } });
    await click("Insert");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The alt text must not contain < or >.",
    );
    expect(currentHtml()).not.toContain("<img");
  });

  test("table block inserts a canonical table", async () => {
    await renderEditor();
    await click("Table");
    await waitFor(() => expect(currentHtml()).toContain("<table>"));
    expectCanonical(currentHtml());
  });

  test("javascript: link shows an error and inserts nothing", async () => {
    await renderEditor();
    await click("Link");
    fireEvent.change(screen.getByLabelText("Link target"), {
      target: { value: "javascript:alert(1)" },
    });
    await click("Insert");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(currentHtml()).not.toContain("<a");
  });

  test("https link without selection inserts the href as linked text", async () => {
    await renderEditor();
    await click("Link");
    fireEvent.change(screen.getByLabelText("Link target"), {
      target: { value: "https://example.org" },
    });
    await click("Insert");
    await waitFor(() =>
      expect(currentHtml()).toContain('<a href="https://example.org">https://example.org</a>'),
    );
    expectCanonical(currentHtml());
  });

  test("paragraph style select switches to a heading", async () => {
    await renderEditor();
    await chooseOption(`${CONTENT_EDITOR_ELEMENT_ID}-paragraph-style`, "2");
    await waitFor(() => expect(currentHtml()).toBe("<h2></h2>"));
    expectCanonical(currentHtml());
  });

  test("bold toggles the mark on following input", async () => {
    await renderEditor();
    await click("Bold");
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("PDF blocks offer page break and no button block", async () => {
    await renderEditor({ blocks: PDF_DOCUMENT_BLOCKS });
    expect(screen.queryByRole("button", { name: "Button" })).toBeNull();
    await click("Page break");
    await waitFor(() => expect(currentHtml()).toContain('<div data-page-break=""></div>'));
    expectCanonical(currentHtml());
  });

  test("readOnly disables the toolbar buttons", async () => {
    await renderEditor({ readOnly: true });
    for (const name of ["Bold", "Italic", "Placeholder", "Divider", "Table"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
