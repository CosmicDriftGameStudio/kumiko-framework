import { describe, expect, mock, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import {
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../__tests__/test-utils";
import { QueryTable } from "../query-table";

function renderWithDispatcher(ui: ReactNode, dispatcher: Dispatcher) {
  return render(<DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>);
}

const COLUMNS = [
  { field: "name", label: "Name" },
  { field: "plan", label: "Plan" },
] as const;

describe("QueryTable", () => {
  test("rendert Query-Result als DataTable-Rows", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [
          { id: "t1", name: "Acme", plan: "pro" },
          { id: "t2", name: "Beta GmbH", plan: "free" },
        ],
      })) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(
      <QueryTable query="tenant:query:tenant:list" columns={COLUMNS} testId="tbl" />,
      dispatcher,
    );
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
    expect(screen.getByText("Beta GmbH")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
  });

  test("Row-Click liefert die geklickte Row", async () => {
    const onRowClick = mock((_row: { id: string }) => {});
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [{ id: "t1", name: "Acme", plan: "pro" }],
      })) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(
      <QueryTable query="tenant:query:tenant:list" columns={COLUMNS} onRowClick={onRowClick} />,
      dispatcher,
    );
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
    fireEvent.click(screen.getByText("Acme"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]?.[0]?.id).toBe("t1");
  });

  test("Fehler → ErrorState, Retry refetcht", async () => {
    let calls = 0;
    const dispatcher = createMockDispatcher({
      query: (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            isSuccess: false,
            error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
          };
        }
        return { isSuccess: true, data: [{ id: "t1", name: "Acme", plan: "pro" }] };
      }) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(
      <QueryTable query="tenant:query:tenant:list" columns={COLUMNS} testId="tbl" />,
      dispatcher,
    );
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
    expect(calls).toBe(2);
  });

  test("leeres Result rendert Empty-State", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
    });
    const { container } = renderWithDispatcher(
      <QueryTable
        query="tenant:query:tenant:list"
        columns={COLUMNS}
        emptyState={<span>Keine Tenants</span>}
      />,
      dispatcher,
    );
    await waitFor(() => expect(screen.getByText("Keine Tenants")).toBeTruthy());
    expect(container.querySelectorAll("tbody tr").length).toBe(0);
  });

  test("rows-Selector zieht Rows aus verschachteltem Result", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { items: [{ id: "x", name: "Nested", plan: "pro" }], total: 1 },
      })) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(
      <QueryTable<{ items: readonly Record<string, unknown>[]; total: number }>
        query="tenant:query:tenant:list"
        columns={COLUMNS}
        rows={(data) => data.items}
      />,
      dispatcher,
    );
    await waitFor(() => expect(screen.getByText("Nested")).toBeTruthy());
  });
});
