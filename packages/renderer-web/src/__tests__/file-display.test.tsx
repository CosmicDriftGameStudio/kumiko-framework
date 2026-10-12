import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { RenderField, RenderList } from "@cosmicdrift/kumiko-renderer";
import { fireEvent, waitFor } from "@testing-library/react";
import { FileDisplayCell, FileNameLink, FileThumbnail } from "../primitives/file-thumbnail.js";
import { FileUploadInput } from "../primitives/file-upload.js";
import { render } from "./test-utils.js";

const FILE_ID = "11111111-2222-4333-8444-555555555555";
const realFetch = globalThis.fetch;

function stubMeta(fileName: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ id: FILE_ID, fileName, mimeType: "application/pdf", size: 1 }), {
      status: 200,
    })) as unknown as typeof fetch;
}

beforeEach(() => stubMeta("floorplan.pdf"));
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("FileThumbnail fallback chain", () => {
  test("requests the variant first, then the original, then shows a placeholder", () => {
    const { container } = render(<FileThumbnail fileId={FILE_ID} variant="thumb" />);
    const img = () => container.querySelector("img");
    expect(img()?.getAttribute("src")).toBe(`/api/files/${FILE_ID}/variant/thumb`);
    fireEvent.error(img() as HTMLImageElement);
    expect(img()?.getAttribute("src")).toBe(`/api/files/${FILE_ID}`);
    fireEvent.error(img() as HTMLImageElement);
    expect(img()).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("without a variant the original is the only source", () => {
    const { container } = render(<FileThumbnail fileId={FILE_ID} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/api/files/${FILE_ID}`);
  });

  test("keeps the whole image visible instead of cropping it", () => {
    const { container } = render(<FileThumbnail fileId={FILE_ID} />);
    const classes = container.querySelector("img")?.className ?? "";
    expect(classes).toContain("object-contain");
    expect(classes).not.toContain("rounded-full");
  });
});

describe("FileNameLink", () => {
  test("shows the file name from the meta endpoint as a download link", async () => {
    const { findByText } = render(<FileNameLink fileId={FILE_ID} fallbackLabel="File attached" />);
    const link = await findByText("floorplan.pdf");
    expect(link.getAttribute("href")).toBe(`/api/files/${FILE_ID}`);
  });

  test("keeps the fallback label when the meta request fails", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const { getByText } = render(<FileNameLink fileId={FILE_ID} fallbackLabel="File attached" />);
    await Promise.resolve();
    expect(getByText("File attached")).toBeDefined();
  });
});

describe("FileDisplayCell", () => {
  test("an image list shows the first thumbnail and the remaining count", () => {
    const { container, getByText } = render(
      <FileDisplayCell
        value={[FILE_ID, "b", "c"]}
        display={{ kind: "image", variant: "thumb" }}
        fallbackLabel="File"
      />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(getByText("+2")).toBeDefined();
  });

  test("an empty value renders nothing", () => {
    const { container } = render(
      <FileDisplayCell value={[]} display={{ kind: "file" }} fallbackLabel="File" />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("FileUploadInput", () => {
  test("a disabled input shows the value without change or remove controls", () => {
    const { queryByRole, container } = render(
      <FileUploadInput kind="image" id="a" value={FILE_ID} onChange={() => {}} disabled />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(queryByRole("button")).toBeNull();
  });

  test("a file value shows its file name instead of a bare hint", async () => {
    const { findByText } = render(
      <FileUploadInput kind="file" id="f" value={FILE_ID} onChange={() => {}} />,
    );
    expect(await findByText("floorplan.pdf")).toBeDefined();
  });
});

describe("read-only file fields", () => {
  function readOnlyField(type: string, value: unknown): EditFieldViewModel {
    return {
      field: "plan",
      label: "Plan",
      type,
      value,
      visible: true,
      readOnly: true,
      required: false,
    };
  }

  test("a read-only image shows a thumbnail, never the FileRef UUID", () => {
    const { container } = render(
      <RenderField
        field={readOnlyField("image", FILE_ID)}
        onChange={() => {}}
        valueDisplay="text"
      />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.textContent).not.toContain(FILE_ID);
  });

  test("a read-only file list shows file names, never UUIDs", async () => {
    const { findByText, container } = render(
      <RenderField
        field={readOnlyField("files", [FILE_ID])}
        onChange={() => {}}
        valueDisplay="text"
      />,
    );
    expect(await findByText("floorplan.pdf")).toBeDefined();
    expect(container.textContent).not.toContain(FILE_ID);
  });
});

describe("list file columns", () => {
  const entity = {
    fields: {
      name: { type: "text", sortable: false },
      photo: { type: "image", variants: { thumb: {} } },
    },
  } as unknown as EntityDefinition;

  test("an image field column renders a thumbnail from its first variant", async () => {
    const { container } = render(
      <RenderList
        screen={{ id: "l", type: "entityList", entity: "unit", columns: ["name", "photo"] }}
        entity={entity}
        rows={[{ id: "r1", name: "Flat", photo: FILE_ID }]}
        featureName="rental"
      />,
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `/api/files/${FILE_ID}/variant/thumb`,
    );
    expect(container.textContent).not.toContain(FILE_ID);
  });

  test("a { format: 'file' } column renders the file name", async () => {
    const { findByText } = render(
      <RenderList
        screen={{
          id: "l",
          type: "entityList",
          entity: "__projection__",
          columns: [{ field: "doc", renderer: { format: "file" } }],
        }}
        entity={{ fields: { doc: { type: "text" } } } as unknown as EntityDefinition}
        rows={[{ id: "r1", doc: FILE_ID }]}
        featureName="rental"
      />,
    );
    expect(await findByText("floorplan.pdf")).toBeDefined();
  });
});
