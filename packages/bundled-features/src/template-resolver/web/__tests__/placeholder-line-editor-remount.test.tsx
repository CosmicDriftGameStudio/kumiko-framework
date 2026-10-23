import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import type { DocumentEditorHandle } from "../document-toolbar-blocks.ts";
import { defaultTranslations } from "../i18n.ts";
import PlaceholderLineEditor from "../placeholder-line-editor.tsx";

const localeResolver = createStaticLocaleResolver({ locale: "en" });
const FLUSH_TIPTAP_TIMERS_MS = 20;

// Chrome fires tiptap's setTimeout(0) onCreate before its setTimeout(1) destroy; bun clamps 0 to 1 ms
// and fires them in scheduling order, so the browser order is pinned by delaying the 1 ms timers.
function pinBrowserTimerOrder(): () => void {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: () => void, delay?: number, ...args: unknown[]) =>
    realSetTimeout(handler, delay === 1 ? 5 : delay, ...args)) as typeof setTimeout;
  return () => {
    globalThis.setTimeout = realSetTimeout;
  };
}

// Same registry semantics as the designer's insert targets: null unregisters the field.
function LabelledLine({ registry }: { readonly registry: Record<string, DocumentEditorHandle> }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [value, setValue] = useState("");
  const registerRef = useRef((handle: DocumentEditorHandle | null): void => {
    if (handle === null) delete registry["footer"];
    else registry["footer"] = handle;
  });
  return (
    <LocaleProvider
      resolver={localeResolver}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>
        <PlaceholderLineEditor
          id="line"
          aria-label="Line"
          value={value}
          onChange={setValue}
          variableLabels={labels}
          onEditorReady={registerRef.current}
        />
        <button type="button" onClick={() => setLabels({ noticeLabel: "Notice" })}>
          load labels
        </button>
        <output data-testid="value">{value}</output>
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("PlaceholderLineEditor remount", () => {
  test("the new editor's handle stays registered after the replaced editor is torn down", async () => {
    const restoreTimers = pinBrowserTimerOrder();
    try {
      const registry: Record<string, DocumentEditorHandle> = {};
      render(<LabelledLine registry={registry} />);
      await waitFor(() => expect(registry["footer"]).toBeDefined());

      fireEvent.click(screen.getByRole("button", { name: "load labels" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, FLUSH_TIPTAP_TIMERS_MS));
      });

      const handle = registry["footer"];
      expect(handle).toBeDefined();
      act(() => handle?.insertPlaceholder("noticeLabel"));
      await waitFor(() =>
        expect(screen.getByTestId("value").textContent).toContain("{{noticeLabel}}"),
      );
    } finally {
      restoreTimers();
    }
  });
});
