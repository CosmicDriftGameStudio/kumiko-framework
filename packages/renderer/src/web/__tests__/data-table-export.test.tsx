import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DataTableExport } from "../../data-table-view-types.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const columns = [
  { field: "name", label: "Name", type: "string" as const, sortable: false },
  { field: "city", label: "City", type: "string" as const, sortable: false },
];
const rows = [{ id: "r1", values: { name: "Ada", city: "Wien" } }];
const source: DataTableExport = {
  screen: "shop:screen:item-list",
  screenShortId: "item-list",
  payload: { search: "ada", filters: [{ field: "city", op: "eq", value: "Wien" }] },
  columns: ["city", "name"],
};

const originalFetch = globalThis.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
let fetchMock: ReturnType<typeof mock>;
let downloads: string[];
const originalAnchorClick = HTMLAnchorElement.prototype.click;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = () => "blob:test";
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectUrl;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
});

function stubFetch(response: Response): void {
  fetchMock = mock(async () => response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

function renderTable(): void {
  render(<DataTable columns={columns} rows={rows} testId="t" exportList={source} />);
}

describe("DataTable export button", () => {
  test("posts screen, payload and visible column order, then saves the xlsx", async () => {
    stubFetch(new Response(new Blob(["xlsx"]), { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByTestId("list-export"));
    await waitFor(() => expect(downloads).toHaveLength(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/export/xlsx");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      screen: "shop:screen:item-list",
      payload: source.payload,
      columns: ["city", "name"],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(downloads[0]).toMatch(/^item-list-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(screen.queryByTestId("list-export-hint")).toBeNull();
  });

  test("a 413 shows the narrow-the-filter hint and downloads nothing", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ error: { code: "export_too_many_rows", details: { maxRows: 5 } } }),
        {
          status: 413,
        },
      ),
    );
    renderTable();
    fireEvent.click(screen.getByTestId("list-export"));
    const hint = await screen.findByTestId("list-export-hint");
    expect(hint.getAttribute("role")).toBe("status");
    expect(hint.textContent).toContain("5");
    expect(downloads).toHaveLength(0);
  });

  test("any other failure shows an alert", async () => {
    stubFetch(new Response("{}", { status: 500 }));
    renderTable();
    fireEvent.click(screen.getByTestId("list-export"));
    const hint = await screen.findByTestId("list-export-hint");
    expect(hint.getAttribute("role")).toBe("alert");
    expect(downloads).toHaveLength(0);
  });

  test("the button is disabled while the request is running", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderTable();
    fireEvent.click(screen.getByTestId("list-export"));
    await waitFor(() =>
      expect((screen.getByTestId("list-export") as HTMLButtonElement).disabled).toBe(true),
    );
    finish(new Response(new Blob(["x"]), { status: 200 }));
    await waitFor(() =>
      expect((screen.getByTestId("list-export") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  test("without an export descriptor there is no button", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" />);
    expect(screen.queryByTestId("list-export")).toBeNull();
  });
});
