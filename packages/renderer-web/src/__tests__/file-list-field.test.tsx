import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { RenderField } from "@cosmicdrift/kumiko-renderer";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { render, screen } from "./test-utils.js";

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

  test("readOnly shows no add tile and no remove or reorder buttons", () => {
    renderField(imagesField({ value: [ID_A, ID_B], readOnly: true }));
    expect(document.querySelector("#kumiko-edit-gallery-add")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move file up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move file down" })).toBeNull();
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
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    renderField(imagesField({ field: "docs", type: "files", value: [ID_A] }));
    expect(screen.getByRole("link", { name: "Open file" }).getAttribute("href")).toBe(
      `/api/files/${ID_A}`,
    );
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("read-only file fields as text (valueDisplay=text)", () => {
  function renderText(field: EditFieldViewModel): void {
    render(
      <RenderField
        field={{ ...field, readOnly: true }}
        featureName="orders"
        onChange={() => {}}
        valueDisplay="text"
      />,
    );
  }

  test("a single file shows an open link, never its UUID", () => {
    renderText(imagesField({ field: "scan", type: "file", value: ID_A }));
    const link = screen.getByRole("link", { name: "Open file" });
    expect(link.getAttribute("href")).toBe(`/api/files/${ID_A}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByTestId("field-value-scan").textContent).not.toContain(ID_A);
  });

  test("a single image links the same way", () => {
    renderText(imagesField({ field: "cover", type: "image", value: ID_A }));
    expect(screen.getByRole("link", { name: "Open file" }).getAttribute("href")).toBe(
      `/api/files/${ID_A}`,
    );
  });

  test("plural fields show one numbered link per file, in order, without UUIDs", () => {
    renderText(imagesField({ value: [ID_B, ID_A] }));
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["File 1", "File 2"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/api/files/${ID_B}`,
      `/api/files/${ID_A}`,
    ]);
    const text = screen.getByTestId("field-value-gallery").textContent ?? "";
    expect(text).not.toContain(ID_A);
    expect(text).not.toContain(ID_B);
  });

  test("an empty value keeps the dash placeholder", () => {
    renderText(imagesField({ value: [] }));
    expect(screen.getByTestId("field-value-gallery").textContent).toBe("—");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
