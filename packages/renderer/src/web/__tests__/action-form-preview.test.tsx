import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const form: ActionFormScreenDefinition = {
  id: "set-status",
  type: "actionForm",
  handler: "tasks:write:set-status",
  fields: {
    status: { type: "text", required: true },
    note: { type: "text" },
  },
  layout: { sections: [{ fields: ["status", "note"] }] },
  preview: {
    query: "tasks:query:set-status-preview",
    fields: ["status"],
    title: "Preview",
    facts: [{ field: "count", label: "Affected tasks" }],
    list: {
      field: "tasks",
      columns: [
        { field: "title", label: "Task" },
        { field: "after", label: "New status" },
      ],
    },
  },
};

const memoryNav = {
  route: { screenId: "set-status" },
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

function renderForm(dispatcher: Dispatcher, screenDefinition: ActionFormScreenDefinition = form) {
  return render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider value={memoryNav}>
        <KumikoScreen
          schema={{ featureName: "tasks", entities: {}, screens: [screenDefinition] }}
          qn="tasks:screen:set-status"
        />
      </NavProvider>
    </DispatcherProvider>,
  );
}

function typeInto(id: string, value: string): void {
  fireEvent.change(document.querySelector(`#kumiko-edit-${id}`) as HTMLInputElement, {
    target: { value },
  });
}

describe("actionForm preview", () => {
  test("a changed form value runs the preview query and renders facts and list", async () => {
    const queries: { type: string; payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        queries.push({ type, payload });
        return {
          isSuccess: true,
          data: {
            count: 2,
            tasks: [
              { title: "Quarterly VAT filing", after: "blocked" },
              { title: "Prepare audit", after: "blocked" },
            ],
          },
        };
      }) as unknown as Dispatcher["query"],
    });
    renderForm(dispatcher);

    expect(queries).toEqual([]);
    typeInto("note", "ignored: not a preview field");
    typeInto("status", "blocked");

    await waitFor(() => expect(screen.getByTestId("action-form-preview")).toBeTruthy());
    expect(queries).toEqual([
      { type: "tasks:query:set-status-preview", payload: { status: "blocked" } },
    ]);
    expect(screen.getByTestId("action-form-preview-fact-0").textContent).toBe("Affected tasks: 2");
    expect(screen.getByText("Quarterly VAT filing")).toBeTruthy();
    expect(screen.getByText("Prepare audit")).toBeTruthy();
  });

  test("an emptied optional field is left out of the preview payload", async () => {
    const queries: unknown[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (_type: string, payload: unknown) => {
        queries.push(payload);
        return { isSuccess: true, data: { count: 0, tasks: [] } };
      }) as unknown as Dispatcher["query"],
    });
    renderForm(dispatcher, {
      ...form,
      preview: { query: "tasks:query:set-status-preview", fields: ["status", "note"] },
    });

    typeInto("note", "draft");
    typeInto("note", "");
    typeInto("status", "blocked");

    await waitFor(() => expect(queries.length).toBeGreaterThan(0));
    expect(queries.at(-1)).toEqual({ status: "blocked" });
  });

  test("an untouched optional money field stays out of the preview payload", async () => {
    const queries: unknown[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (_type: string, payload: unknown) => {
        queries.push(payload);
        return { isSuccess: true, data: { count: 0, tasks: [] } };
      }) as unknown as Dispatcher["query"],
    });
    renderForm(dispatcher, {
      ...form,
      fields: {
        ...form.fields,
        fee: { type: "money", currency: { kind: "literal", code: "EUR" } },
      },
      layout: { sections: [{ fields: ["status", "note", "fee"] }] },
      preview: { query: "tasks:query:set-status-preview", fields: ["status", "fee"] },
    });

    typeInto("status", "blocked");

    await waitFor(() => expect(queries.length).toBeGreaterThan(0));
    expect(queries.at(-1)).toEqual({ status: "blocked" });
  });

  test("typed facts and columns render formatted: money object and date string", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          total: { amount: 1234.5, currency: "EUR" },
          dueOn: "2026-11-30",
          rows: [{ label: "Rate 1", amount: { amount: 12.5, currency: "EUR" } }],
        },
      })) as unknown as Dispatcher["query"],
    });
    renderForm(dispatcher, {
      ...form,
      preview: {
        query: "tasks:query:set-status-preview",
        fields: ["status"],
        facts: [
          { field: "total", label: "Total", type: "money" },
          { field: "dueOn", label: "Due", type: "date" },
        ],
        list: {
          field: "rows",
          columns: [
            { field: "label", label: "Rate" },
            { field: "amount", label: "Amount", type: "money" },
          ],
        },
      },
    });

    typeInto("status", "blocked");
    await waitFor(() => expect(screen.getByTestId("action-form-preview")).toBeTruthy());
    expect(screen.getByTestId("action-form-preview-fact-0").textContent).toBe("Total: €1,234.50");
    const due = screen.getByTestId("action-form-preview-fact-1").textContent ?? "";
    expect(due).not.toContain("2026-11-30");
    expect(due).toContain("2026");
    expect(screen.getByText("€12.50")).toBeTruthy();
  });

  test("a failing preview query shows a hint and does not block the submit", async () => {
    const writes: unknown[] = [];
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: false,
        error: {
          code: "internal_error",
          message: "Preview is unavailable",
          i18nKey: "preview.unavailable",
        },
      })) as unknown as Dispatcher["query"],
      write: (async (_type: string, payload: unknown) => {
        writes.push(payload);
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    renderForm(dispatcher);

    typeInto("status", "blocked");
    await waitFor(() => expect(screen.getByTestId("action-form-preview-error")).toBeTruthy());
    expect(screen.getByTestId("action-form-preview-error").textContent).toContain(
      "Preview is unavailable",
    );

    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes).toEqual([{ status: "blocked" }]));
  });
});
