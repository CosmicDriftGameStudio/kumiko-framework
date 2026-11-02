import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "../../../index.ts";
import { defaultPrimitives } from "../../index.ts";
import { EditorWorkbench, type WorkbenchSave } from "../editor-workbench.tsx";

const CLEAN: WorkbenchSave = {
  busy: false,
  canSave: false,
  dirty: false,
  onSave: () => {},
  onDiscard: () => {},
  saveError: null,
};

function mount(save: WorkbenchSave): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>
        <EditorWorkbench
          testId="wb"
          title="Terms"
          info={{ edit: "Edit info", preview: "Preview info" }}
          edit={<div data-testid="edit-pane" />}
          preview={<div data-testid="preview-pane" />}
          rail={{
            edit: <div data-testid="edit-rail" />,
            preview: <div data-testid="preview-rail" />,
          }}
          save={save}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

afterEach(cleanup);

describe("EditorWorkbench", () => {
  test("opens in edit mode with the edit pane, its rail and its info text", () => {
    mount(CLEAN);
    expect(screen.getByTestId("edit-pane")).toBeDefined();
    expect(screen.getByTestId("edit-rail")).toBeDefined();
    expect(screen.getByTestId("wb-info").textContent).toContain("Edit info");
    expect(screen.queryByTestId("preview-pane")).toBeNull();
  });

  test("the mode switch swaps pane, rail and info text together", () => {
    mount(CLEAN);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("preview-pane")).toBeDefined();
    expect(screen.getByTestId("preview-rail")).toBeDefined();
    expect(screen.getByTestId("wb-info").textContent).toContain("Preview info");
    expect(screen.queryByTestId("edit-pane")).toBeNull();
  });

  test("the footer says there is nothing to save and offers no discard when clean", () => {
    mount(CLEAN);
    expect(screen.getByTestId("wb-footer-message").textContent).toBe("No unsaved changes");
    expect((screen.getByTestId("editor-discard") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("editor-save") as HTMLButtonElement).disabled).toBe(true);
  });

  test("unsaved changes are flagged and save and discard call back", () => {
    const onSave = mock(() => {});
    const onDiscard = mock(() => {});
    mount({ ...CLEAN, dirty: true, canSave: true, onSave, onDiscard });
    expect(screen.getByTestId("wb-footer-message").textContent).toContain("Unsaved changes");
    fireEvent.click(screen.getByTestId("editor-save"));
    fireEvent.click(screen.getByTestId("editor-discard"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  test("a save error replaces the footer message", () => {
    mount({ ...CLEAN, dirty: true, saveError: "Version conflict" });
    expect(screen.getByTestId("wb-save-error").textContent).toContain("Version conflict");
  });

  test("a custom save label names the action", () => {
    mount({ ...CLEAN, dirty: true, canSave: true, saveLabel: "Create" });
    expect(screen.getByTestId("editor-save").textContent).toBe("Create");
  });
});
