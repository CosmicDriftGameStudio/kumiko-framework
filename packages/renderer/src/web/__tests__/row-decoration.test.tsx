// rowDecoration: computed row fields from an app query, merged into projectionList and entityList rows.
import { describe, expect, test } from "bun:test";
import type {
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { mergeRowDecoration, useRowDecoration } from "../../app/use-row-decoration.ts";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, taskEntity, waitFor } from "./test-utils.tsx";

const DECORATION_QUERY = "shop:query:order:decorate";
const LIST_QUERY = "shop:query:order:list";

const projectionList: ProjectionListScreenDefinition = {
  id: "orders",
  type: "projectionList",
  query: LIST_QUERY,
  rowToneField: "tone",
  rowDecoration: { query: DECORATION_QUERY, params: { scope: "mine" } },
  columns: [{ field: "name" }, { field: "next", hint: { detailField: "due" } }, { field: "stage" }],
};

const entityList: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  rowToneField: "tone",
  rowDecoration: { query: "shop:query:task:decorate" },
  columns: ["title", { field: "stage", label: "Stage" }],
};

type Call = { readonly type: string; readonly payload: unknown };

function mockQueries(
  rows: readonly Record<string, unknown>[],
  decoration: (call: Call) => unknown,
  listQuery: string,
): { readonly query: Dispatcher["query"]; readonly calls: Call[] } {
  const calls: Call[] = [];
  const query = (async (type: string, payload: unknown) => {
    calls.push({ type, payload });
    if (type === listQuery) return { isSuccess: true, data: { rows, nextCursor: null } };
    const answer = decoration({ type, payload });
    return answer instanceof Error
      ? { isSuccess: false, error: { code: "boom", message: answer.message } }
      : { isSuccess: true, data: answer };
  }) as unknown as Dispatcher["query"];
  return { query, calls };
}

function renderProjection(query: Dispatcher["query"]): void {
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [projectionList] }}
        qn="shop:screen:orders"
      />
    </DispatcherProvider>,
  );
}

function renderEntity(query: Dispatcher["query"]): void {
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: { task: taskEntity }, screens: [entityList] }}
        qn="shop:screen:task-list"
      />
    </DispatcherProvider>,
  );
}

const ORDER_ROWS = [
  { id: "o1", name: "Order 1", stage: "raw" },
  { id: "o2", name: "Order 2", stage: "raw" },
];

function decorateOrders(): unknown {
  return {
    rows: [
      { id: "o1", next: "Call customer", due: "today", tone: "bad", stage: "overdue" },
      { id: "o2", next: "Ship it", due: "Friday", tone: "ok" },
    ],
  };
}

describe("projectionList rowDecoration", () => {
  test("one call with the page ids and params merges fields, tone stripe and collisions into the rows", async () => {
    const { query, calls } = mockQueries(ORDER_ROWS, decorateOrders, LIST_QUERY);
    renderProjection(query);
    await waitFor(() => expect(screen.getByText("Call customer")).toBeTruthy());

    const decorationCalls = calls.filter((call) => call.type === DECORATION_QUERY);
    expect(decorationCalls).toHaveLength(1);
    expect(decorationCalls[0]?.payload).toEqual({ scope: "mine", ids: ["o1", "o2"] });
    expect(screen.getByText("today")).toBeTruthy();
    expect(screen.getByText("Order 1").closest("tr")?.className).toContain("--color-status-bad");
    expect(screen.getByText("Order 2").closest("tr")?.className).toContain("--color-status-ok");
    expect(screen.getByTestId("cell-o1-stage").textContent).toBe("overdue");
    expect(screen.getByTestId("cell-o2-stage").textContent).toBe("raw");
  });

  test("a failing decoration query leaves the plain rows without an error state", async () => {
    const { query, calls } = mockQueries(
      ORDER_ROWS,
      () => new Error("decoration down"),
      LIST_QUERY,
    );
    renderProjection(query);
    await waitFor(() => expect(calls.some((call) => call.type === DECORATION_QUERY)).toBe(true));
    await waitFor(() => expect(screen.getByText("Order 1")).toBeTruthy());
    expect(screen.getAllByText("raw")).toHaveLength(2);
    expect(screen.queryByText("decoration down")).toBeNull();
    expect(screen.queryByText("Call customer")).toBeNull();
  });
});

describe("entityList rowDecoration", () => {
  test("a column on a decoration field renders as plain text with its label", async () => {
    const rows = [{ id: "t1", title: "Write report", count: 1, done: false }];
    const { query, calls } = mockQueries(
      rows,
      () => ({ rows: [{ id: "t1", stage: "In review", tone: "warn" }] }),
      "shop:query:task:list",
    );
    renderEntity(query);
    await waitFor(() => expect(screen.getByText("In review")).toBeTruthy());

    expect(screen.getByText("Stage")).toBeTruthy();
    expect(screen.getByText("Write report").closest("tr")?.className).toContain(
      "--color-status-warn",
    );
    const decorationCalls = calls.filter((call) => call.type === "shop:query:task:decorate");
    expect(decorationCalls).toHaveLength(1);
    expect(decorationCalls[0]?.payload).toEqual({ ids: ["t1"] });
  });
});

describe("mergeRowDecoration", () => {
  const rows = [
    { id: "a", name: "A", stage: "raw" },
    { id: "b", name: "B" },
  ];

  test("decoration fields win and the row id is kept", () => {
    const merged = mergeRowDecoration(rows, { rows: [{ id: "a", stage: "done", extra: 1 }] });
    expect(merged[0]).toEqual({ id: "a", name: "A", stage: "done", extra: 1 });
    expect(merged[1]).toBe(rows[1]);
  });

  test("foreign ids and malformed entries are ignored", () => {
    const answer = { rows: [{ id: "zzz", stage: "x" }, null, "a", { stage: "no id" }, { id: 7 }] };
    expect(mergeRowDecoration(rows, answer)).toEqual(rows);
  });

  test.each([[null], [undefined], ["x"], [[]], [{}], [{ rows: "nope" }]])(
    "a malformed answer %p changes nothing",
    (answer) => {
      expect(mergeRowDecoration(rows, answer)).toBe(rows);
    },
  );
});

type HarnessRow = Readonly<Record<string, unknown>>;

function Harness({
  rows,
  resetKey,
}: {
  readonly rows: readonly HarnessRow[];
  readonly resetKey: string;
}) {
  const decorated = useRowDecoration({ query: DECORATION_QUERY }, rows, rows, resetKey);
  return <p data-testid="out">{decorated.map((row) => String(row["stage"])).join(",")}</p>;
}

function renderHarness(initial: readonly HarnessRow[]) {
  const calls: Call[] = [];
  const query = (async (type: string, payload: unknown) => {
    calls.push({ type, payload });
    const ids = (payload as { ids: string[] }).ids;
    return {
      isSuccess: true,
      data: { rows: ids.map((id) => ({ id, stage: `${id}${calls.length}` })) },
    };
  }) as unknown as Dispatcher["query"];
  const dispatcher = createMockDispatcher({ query });
  const tree = (rows: readonly HarnessRow[], resetKey: string) => (
    <DispatcherProvider dispatcher={dispatcher}>
      <Harness rows={rows} resetKey={resetKey} />
    </DispatcherProvider>
  );
  const view = render(tree(initial, "k1"));
  return {
    calls,
    rerender: (rows: readonly HarnessRow[], resetKey = "k1") => view.rerender(tree(rows, resetKey)),
  };
}

describe("useRowDecoration call count", () => {
  test("a new list answer with the same ids refetches once", async () => {
    const { calls, rerender } = renderHarness([{ id: "a" }]);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("a1"));

    rerender([{ id: "a" }]);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("a2"));
    expect(calls).toHaveLength(2);
  });

  test("an appended page sends only the new ids and keeps the earlier decoration", async () => {
    const { calls, rerender } = renderHarness([{ id: "a" }]);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("a1"));

    rerender([{ id: "a" }, { id: "b" }]);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("a1,b2"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.payload).toEqual({ ids: ["b"] });
  });

  test("a resetKey change sends every id again and drops the earlier decoration", async () => {
    const { calls, rerender } = renderHarness([{ id: "a" }, { id: "b" }]);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("a1,b1"));

    rerender([{ id: "a" }, { id: "b" }], "k2");
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("a2,b2"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.payload).toEqual({ ids: ["a", "b"] });
  });

  test("an empty page sends no decoration call", async () => {
    const { calls } = renderHarness([]);
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });
});
