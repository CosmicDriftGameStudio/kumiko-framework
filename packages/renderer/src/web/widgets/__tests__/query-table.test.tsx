import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../../headless/index.ts";
import { DispatcherProvider } from "../../../index.ts";
import {
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../__tests__/test-utils.tsx";
import { QueryTable } from "../query-table.tsx";

function renderWithDispatcher(ui: ReactNode, dispatcher: Dispatcher) {
  return render(<DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>);
}

const COLUMNS = [
  { field: "name", label: "Name" },
  { field: "plan", label: "Plan" },
] as const;

describe("QueryTable", () => {
  test("renders the query result as DataTable rows", async () => {
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: [
          { id: "t1", name: "Acme", plan: "pro" },
          { id: "t2", name: "Beta GmbH", plan: "free" },
        ],
      }),
    });
    renderWithDispatcher(
      <QueryTable query="tenant:query:tenant:list" columns={COLUMNS} testId="tbl" />,
      dispatcher,
    );
    await waitFor(() => screen.getByText("Acme"));
    screen.getByText("Beta GmbH");
    screen.getByText("Name");
  });

  test("row click provides the clicked row", async () => {
    const onRowClick = mock((_row: { id: string }) => {});
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: [{ id: "t1", name: "Acme", plan: "pro" }],
      }),
    });
    renderWithDispatcher(
      <QueryTable query="tenant:query:tenant:list" columns={COLUMNS} onRowClick={onRowClick} />,
      dispatcher,
    );
    await waitFor(() => screen.getByText("Acme"));
    fireEvent.click(screen.getByText("Acme"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]?.[0]?.id).toBe("t1");
  });

  test("Fehler → ErrorState, Retry refetcht", async () => {
    let calls = 0;
    const dispatcher = createMockDispatcher({
      query: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            isSuccess: false,
            error: {
              code: "internal",
              httpStatus: 500,
              message: "kaputt",
              i18nKey: "errors.internal",
            },
          };
        }
        return { isSuccess: true, data: [{ id: "t1", name: "Acme", plan: "pro" }] };
      },
    });
    renderWithDispatcher(
      <QueryTable query="tenant:query:tenant:list" columns={COLUMNS} testId="tbl" />,
      dispatcher,
    );
    await waitFor(() => screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => screen.getByText("Acme"));
    expect(calls).toBe(2);
  });

  test("leeres Result rendert Empty-State", async () => {
    const dispatcher = createMockDispatcher({
      query: async () => ({ isSuccess: true, data: [] }),
    });
    const { container } = renderWithDispatcher(
      <QueryTable
        query="tenant:query:tenant:list"
        columns={COLUMNS}
        emptyState={<span>Keine Tenants</span>}
      />,
      dispatcher,
    );
    await waitFor(() => screen.getByText("Keine Tenants"));
    expect(container.querySelectorAll("tbody tr").length).toBe(0);
  });

  test("row selector extracts rows from nested result", async () => {
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: { items: [{ id: "x", name: "Nested", plan: "pro" }], total: 1 },
      }),
    });
    renderWithDispatcher(
      <QueryTable<{ items: readonly Record<string, unknown>[]; total: number }>
        query="tenant:query:tenant:list"
        columns={COLUMNS}
        rows={(data) => data.items}
      />,
      dispatcher,
    );
    await waitFor(() => screen.getByText("Nested"));
  });
});
