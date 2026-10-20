import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, waitFor } from "@testing-library/react";
import type { EditFieldViewModel } from "../../headless/index.ts";
import { RenderField, RenderList } from "../../index.ts";
import {
  FileDisplayCell,
  FileNameLink,
  FileThumbnail,
  fileOriginalUrl,
  fileVariantUrl,
} from "../primitives/file-thumbnail.tsx";
import { FileUploadInput } from "../primitives/file-upload.tsx";
import { render } from "./test-utils.tsx";

// The meta cache is module-wide, so every test file uses its own ids.
const FILE_ID = "aaaaaaaa-2222-4333-8444-555555555555";
const realFetch = globalThis.fetch;

function stubMeta(fileName: string): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        files: [{ id: FILE_ID, fileName, mimeType: "application/pdf", size: 1 }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
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

  test("the image loads lazily and decodes off the main thread", () => {
    const { container } = render(<FileThumbnail fileId={FILE_ID} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
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
    let requested = false;
    globalThis.fetch = (async () => {
      requested = true;
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const { getByText } = render(
      <FileNameLink fileId="22222222-2222-4333-8444-555555555555" fallbackLabel="File attached" />,
    );
    await waitFor(() => expect(requested).toBe(true));
    expect(getByText("File attached")).toBeDefined();
  });

  test("an id the batch answer leaves out keeps the fallback label", async () => {
    let requested = false;
    globalThis.fetch = (async () => {
      requested = true;
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const { getByText } = render(
      <FileNameLink fileId="33333333-2222-4333-8444-555555555555" fallbackLabel="File attached" />,
    );
    await waitFor(() => expect(requested).toBe(true));
    expect(getByText("File attached")).toBeDefined();
  });

  test("file names rendered in the same pass share one batched request", async () => {
    const ids = [
      "44444444-2222-4333-8444-555555555551",
      "44444444-2222-4333-8444-555555555552",
      "44444444-2222-4333-8444-555555555553",
    ];
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          files: ids.map((id, index) => ({ id, fileName: `batch-${index}.pdf` })),
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { findByText } = render(
      <>
        {ids.map((id) => (
          <FileNameLink key={id} fileId={id} fallbackLabel="File attached" />
        ))}
      </>,
    );
    expect(await findByText("batch-2.pdf")).toBeDefined();
    expect(urls).toEqual([`/api/files/meta?ids=${ids.join(",")}`]);
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

  test("an image column shrinks to its preview and the preview is a cropped 64px-high thumbnail", async () => {
    const { container } = render(
      <RenderList
        screen={{ id: "l", type: "entityList", entity: "unit", columns: ["name", "photo"] }}
        entity={entity}
        rows={[{ id: "r1", name: "Flat", photo: FILE_ID }]}
        featureName="rental"
      />,
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const photoClasses = (testId: string) =>
      container.querySelector(`[data-testid="${testId}"]`)?.className ?? "";
    expect(photoClasses("column-photo")).toContain("w-px");
    expect(photoClasses("cell-r1-photo")).toContain("w-px");
    expect(photoClasses("column-name")).not.toContain("w-px");
    expect(photoClasses("cell-r1-name")).not.toContain("w-px");
    const imgClasses = container.querySelector("img")?.className ?? "";
    expect(imgClasses).toContain("h-16");
    expect(imgClasses).toContain("max-w-24");
    expect(imgClasses).toContain("object-cover");
    expect(imgClasses).not.toContain("object-contain");
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

describe("file URLs from untrusted values", () => {
  const ID = FILE_ID;

  test("a valid id and variant build the expected paths", () => {
    expect(fileOriginalUrl(ID)).toBe(`/api/files/${ID}`);
    expect(fileVariantUrl(ID, "thumb")).toBe(`/api/files/${ID}/variant/thumb`);
  });

  test("path segments are encoded", () => {
    expect(fileOriginalUrl("a?b")).toBe("/api/files/a%3Fb");
    expect(fileVariantUrl(ID, "../x")).toBe(`/api/files/${ID}/variant/..%2Fx`);
  });

  test.each(["../x", "a?b", "a#b"])(
    "a non-uuid id %p renders a placeholder and no request",
    (bad) => {
      const originalFetch = globalThis.fetch;
      const calls: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL) => {
        calls.push(String(input));
        return Promise.reject(new Error("no network"));
      }) as typeof fetch;
      try {
        const { container } = render(
          <>
            <FileThumbnail fileId={bad} variant="thumb" />
            <FileNameLink fileId={bad} fallbackLabel="Attached" />
          </>,
        );
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("a")).toBeNull();
        expect(container.textContent).toContain("Attached");
        expect(calls).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});
