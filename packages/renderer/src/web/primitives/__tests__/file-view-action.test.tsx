import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DataTable } from "../../__tests__/_primitives-helpers.tsx";
import { render } from "../../__tests__/test-utils.tsx";
import { DataTableCell } from "../data-table-cell.tsx";
import { clearFileMetaCache } from "../file-thumbnail.tsx";

const PDF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PNG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_PDF_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const mimeById: Record<string, string> = {
  [PDF_ID]: "application/pdf",
  [PNG_ID]: "image/png",
  [SECOND_PDF_ID]: "application/pdf",
};

const realFetch = globalThis.fetch;
let metaRequests: string[] = [];

beforeEach(() => {
  clearFileMetaCache();
  metaRequests = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith("/api/files/meta")) return new Response("", { status: 404 });
    metaRequests.push(url);
    const files = Object.entries(mimeById).map(([id, mimeType]) => ({
      id,
      fileName: `${id.slice(0, 4)}.bin`,
      mimeType,
    }));
    return new Response(JSON.stringify({ files }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function FileRow({ fileId }: { readonly fileId: string }) {
  return (
    <DataTableCell
      value={fileId}
      row={{}}
      field="file"
      type="file"
      fileDisplay={{ kind: "file", viewInDrawer: true }}
    />
  );
}

describe("file cell viewInDrawer", () => {
  test("a PDF row offers View, which opens the viewer drawer", async () => {
    render(<FileRow fileId={PDF_ID} />);
    const viewButton = await screen.findByTestId(`file-view-${PDF_ID}`);
    expect(screen.queryByTestId(`file-view-drawer-${PDF_ID}`)).toBeNull();
    fireEvent.click(viewButton);
    await waitFor(() => expect(screen.getByTestId(`file-view-drawer-${PDF_ID}`)).toBeTruthy());
  });

  test("View and the drawer's controls do not open the clicked row", async () => {
    const onRowClick = mock();
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string" as const, sortable: false },
          {
            field: "file",
            label: "File",
            type: "file" as const,
            sortable: false,
            fileDisplay: { kind: "file", viewInDrawer: true },
          },
        ]}
        rows={[{ id: "r1", values: { name: "Doc", file: PDF_ID } }]}
        onRowClick={onRowClick}
        testId="t"
      />,
    );
    fireEvent.click(await screen.findByTestId(`file-view-${PDF_ID}`));
    const drawer = await screen.findByTestId(`file-view-drawer-${PDF_ID}`);
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("a non-PDF row has no View action, and all rows share one meta request", async () => {
    render(
      <div>
        <FileRow fileId={PDF_ID} />
        <FileRow fileId={PNG_ID} />
        <FileRow fileId={SECOND_PDF_ID} />
      </div>,
    );
    await screen.findByTestId(`file-view-${PDF_ID}`);
    await screen.findByTestId(`file-view-${SECOND_PDF_ID}`);
    expect(screen.queryByTestId(`file-view-${PNG_ID}`)).toBeNull();
    expect(metaRequests).toHaveLength(1);
  });

  test("without viewInDrawer the file cell stays download-only", async () => {
    render(
      <DataTableCell
        value={PDF_ID}
        row={{}}
        field="file"
        type="file"
        fileDisplay={{ kind: "file" }}
      />,
    );
    await screen.findByText(/\.bin$/);
    expect(screen.queryByTestId(`file-view-${PDF_ID}`)).toBeNull();
  });
});
