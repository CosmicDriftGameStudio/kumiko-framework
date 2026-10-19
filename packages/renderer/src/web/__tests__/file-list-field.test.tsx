import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { EditFieldViewModel } from "../../headless/index.ts";
import { RenderField } from "../../index.ts";
import { render, screen } from "./test-utils.tsx";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";
const ID_C = "33333333-3333-3333-3333-333333333333";

function imagesField(overrides: Partial<EditFieldViewModel> = {}): EditFieldViewModel {
  return {
    field: "gallery",
    label: "Gallery",
    type: "images",
    value: [],
    visible: true,
    readOnly: false,
    required: false,
    entityType: "order",
    fieldName: "gallery",
    ...overrides,
  };
}

function Harness({
  field,
  onValue,
}: {
  readonly field: EditFieldViewModel;
  readonly onValue: (value: unknown) => void;
}) {
  const [value, setValue] = useState<unknown>(field.value);
  return (
    <RenderField
      field={{ ...field, value }}
      featureName="orders"
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function renderField(field: EditFieldViewModel): { readonly emitted: unknown[] } {
  const emitted: unknown[] = [];
  render(<Harness field={field} onValue={(v) => emitted.push(v)} />);
  return { emitted };
}

function tileFileIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(
      '[data-testid="kumiko-edit-gallery-file-list"] img',
    ),
  ).map((img) => img.getAttribute("src") ?? "");
}

describe("FileListField (images/files edit widget)", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("no unsupported banner; empty state plus an add tile", () => {
    renderField(imagesField());
    expect(screen.queryByText("This field type can't be edited here yet.")).toBeNull();
    expect(screen.getByText("No files yet.")).toBeDefined();
    expect(document.querySelectorAll('input[type="file"]').length).toBe(1);
  });

  test("renders one tile per id with the image variant preview", () => {
    renderField(imagesField({ value: [ID_A, ID_B], imageVariant: "thumb" }));
    expect(tileFileIds()).toEqual([
      `/api/files/${ID_A}/variant/thumb`,
      `/api/files/${ID_B}/variant/thumb`,
    ]);
  });

  test("add appends the uploaded file id and posts entityId, entityType and fieldName", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: ID_C }), { status: 200 }),
    );
    const { emitted } = renderField(imagesField({ value: [ID_A], entityId: "rec-1" }));
    const addInput = document.querySelector<HTMLInputElement>("#kumiko-edit-gallery-add");
    if (addInput === null) throw new Error("add tile missing");
    fireEvent.change(addInput, {
      target: { files: [new File(["x"], "c.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(emitted).toEqual([[ID_A, ID_C]]));
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("expected a FormData body");
    expect(body.get("entityId")).toBe("rec-1");
    expect(body.get("entityType")).toBe("order");
    expect(body.get("fieldName")).toBe("gallery");
  });

  test("remove drops that tile only", () => {
    const { emitted } = renderField(imagesField({ value: [ID_A, ID_B, ID_C] }));
    const tile = document.querySelector("#kumiko-edit-gallery-1")?.parentElement;
    if (!tile) throw new Error("tile 1 missing");
    fireEvent.click(within(tile).getByRole("button", { name: "Remove" }));
    expect(emitted).toEqual([[ID_A, ID_C]]);
    expect(tileFileIds()).toEqual([`/api/files/${ID_A}`, `/api/files/${ID_C}`]);
  });

  test("a repeated id gets its own row: removing index 1 keeps the first one", () => {
    const errorSpy = spyOn(console, "error");
    try {
      const { emitted } = renderField(imagesField({ value: [ID_A, ID_A] }));
      const tile = document.querySelector("#kumiko-edit-gallery-1")?.parentElement;
      if (!tile) throw new Error("tile 1 missing");
      fireEvent.click(within(tile).getByRole("button", { name: "Remove" }));
      expect(emitted).toEqual([[ID_A]]);
      expect(tileFileIds()).toEqual([`/api/files/${ID_A}`]);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("move up/down reorder, and the edge buttons are hidden", () => {
    const { emitted } = renderField(imagesField({ value: [ID_A, ID_B, ID_C] }));
    expect(screen.queryByTestId("kumiko-edit-gallery-0-move-up")).toBeNull();
    expect(screen.queryByTestId("kumiko-edit-gallery-2-move-down")).toBeNull();
    fireEvent.click(screen.getByTestId("kumiko-edit-gallery-2-move-up"));
    expect(emitted[0]).toEqual([ID_A, ID_C, ID_B]);
    fireEvent.click(screen.getByTestId("kumiko-edit-gallery-0-move-down"));
    expect(emitted[1]).toEqual([ID_C, ID_A, ID_B]);
  });

  test("every icon button has an accessible name", () => {
    renderField(imagesField({ value: [ID_A, ID_B] }));
    expect(screen.getAllByRole("button", { name: "Move file up" }).length).toBe(1);
    expect(screen.getAllByRole("button", { name: "Move file down" }).length).toBe(1);
  });

  test("maxCount reached hides the add tile", () => {
    renderField(imagesField({ value: [ID_A, ID_B], maxCount: 2 }));
    expect(document.querySelectorAll('input[type="file"]').length).toBe(2);
    expect(document.querySelector("#kumiko-edit-gallery-add")).toBeNull();
  });

  test("below maxCount the add tile stays", () => {
    renderField(imagesField({ value: [ID_A], maxCount: 2 }));
    expect(document.querySelector("#kumiko-edit-gallery-add")).not.toBeNull();
  });

  test("readOnly shows no add tile and no row buttons", () => {
    renderField(imagesField({ value: [ID_A, ID_B], readOnly: true }));
    expect(document.querySelector("#kumiko-edit-gallery-add")).toBeNull();
    expect(screen.queryByRole("button", { name: "Move file up" })).toBeNull();
  });

  test("capture reaches the file input of the add tile", () => {
    renderField(imagesField({ capture: "environment" }));
    expect(document.querySelector("#kumiko-edit-gallery-add")?.getAttribute("capture")).toBe(
      "environment",
    );
  });

  test("ignores non-string entries in the stored value", () => {
    renderField(imagesField({ value: [ID_A, 7, null, ""] }));
    expect(tileFileIds()).toEqual([`/api/files/${ID_A}`]);
  });

  test("files fields render file tiles without an image preview", () => {
    renderField(imagesField({ field: "docs", type: "files", value: [ID_A] }));
    expect(screen.getByText("File attached")).toBeDefined();
    expect(document.querySelector("img")).toBeNull();
  });
});
