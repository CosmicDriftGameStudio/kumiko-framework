import { describe, expect, test } from "bun:test";
import {
  CONTENT_EDITOR_ELEMENT_ID,
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
  type TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { type ReactNode, useState } from "react";
import DocumentTiptapEditor from "../document-tiptap-editor.tsx";
import { type DocumentEditorProps, PDF_DOCUMENT_BLOCKS } from "../document-toolbar-blocks.ts";
import { defaultTranslations } from "../i18n.ts";

const dateFormatTranslations: TranslationsByLocale = {
  en: {
    "documentDesigner.editor.dateFormat.short": "Short",
    "documentDesigner.editor.dateFormat.long": "Long",
  },
};
const localeResolver = createStaticLocaleResolver({ locale: "en" });
const VARIABLES = ["due", "note"];

function Controlled(props: Partial<Omit<DocumentEditorProps, "readOnly">>): ReactNode {
  const [value, setValue] = useState("");
  return (
    <LocaleProvider
      resolver={localeResolver}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations, dateFormatTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>
        <DocumentTiptapEditor
          id={CONTENT_EDITOR_ELEMENT_ID}
          value={value}
          onChange={setValue}
          variables={VARIABLES}
          readOnly={false}
          blocks={PDF_DOCUMENT_BLOCKS}
          chrome="canvas"
          {...props}
        />
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

function isTiptapSurface(element: Element | null): element is HTMLElement & { editor: Editor } {
  return element instanceof HTMLElement && "editor" in element;
}

// Happy-dom has no layout, so a click cannot select the chip; tiptap exposes its editor on the surface.
async function selectInsertedPlaceholder(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Placeholder" }));
  fireEvent.click(await screen.findByRole("button", { name: `Insert ${name}` }));
  const surface = document.querySelector(".ProseMirror");
  if (!isTiptapSurface(surface)) throw new Error("editor surface not found");
  surface.focus();
  surface.editor.commands.setNodeSelection(1);
}

async function renderEditor(props: Partial<DocumentEditorProps>): Promise<void> {
  render(<Controlled {...props} />);
  await screen.findByRole("button", { name: "Bold" });
}

describe("date format control", () => {
  test("a date variable offers the short and long format", async () => {
    await renderEditor({ dateVariables: ["due"] });
    await selectInsertedPlaceholder("due");
    expect(await screen.findByRole("button", { name: "Short" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Long" })).toBeDefined();
  });

  test("a text variable offers no date format", async () => {
    await renderEditor({ dateVariables: ["due"] });
    await selectInsertedPlaceholder("note");
    await screen.findByTestId("document-block-options");
    expect(screen.queryByRole("button", { name: "Short" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Long" })).toBeNull();
  });

  test("an unknown variable is treated like a text variable", async () => {
    await renderEditor({ dateVariables: [] });
    await selectInsertedPlaceholder("due");
    await screen.findByTestId("document-block-options");
    expect(screen.queryByRole("button", { name: "Short" })).toBeNull();
  });
});

describe("date format hint on the chip", () => {
  const STYLED = '<p><span data-variable="due" data-date-style="short"></span></p>';
  const STYLED_NOTE = '<p><span data-variable="note" data-date-style="short"></span></p>';

  test("a date variable shows the short date hint", async () => {
    await renderEditor({ value: STYLED, dateVariables: ["due"] });
    const chip = await waitFor(() => {
      const found = document.querySelector("[data-variable-chip]");
      if (found === null) throw new Error("chip not rendered");
      return found;
    });
    expect(chip.textContent).toContain("15.01.2026");
  });

  test("a text variable shows no date hint", async () => {
    await renderEditor({ value: STYLED_NOTE, dateVariables: ["due"] });
    const chip = await waitFor(() => {
      const found = document.querySelector("[data-variable-chip]");
      if (found === null) throw new Error("chip not rendered");
      return found;
    });
    expect(chip.textContent).toBe("note");
  });
});
