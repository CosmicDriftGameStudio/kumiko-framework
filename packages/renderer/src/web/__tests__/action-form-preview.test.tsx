import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { clearFileMetaCache } from "../primitives/file-thumbnail.tsx";
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

function factText(testId: string): string {
  return screen.getByTestId(testId).textContent ?? "";
}

describe("actionForm preview", () => {
  test("single-line facts sit side by side as KPI tiles in one band", async () => {
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: {
          principal: { amount: 10000, currency: "EUR" },
          total: { amount: 10500, currency: "EUR" },
        },
      }),
    });
    renderForm(dispatcher, {
      ...form,
      preview: {
        query: "tasks:query:set-status-preview",
        fields: ["status"],
        facts: [
          { field: "principal", label: "Principal", type: "money" },
          { field: "total", label: "Total", type: "money", emphasize: true },
        ],
      },
    });

    typeInto("status", "blocked");
    await waitFor(() => screen.getByTestId("action-form-preview"));
    const principal = screen.getByTestId("action-form-preview-fact-0");
    const total = screen.getByTestId("action-form-preview-fact-1");
    expect(principal.parentElement).toBe(total.parentElement);
    expect(principal.querySelector("dd")).toBeNull();
    expect(factText("action-form-preview-fact-0")).toBe("Principal€100.00");
    expect(factText("action-form-preview-fact-1")).toBe("Total€105.00");
  });

  test("a long text fact leaves the name-value list and shows its label above the text", async () => {
    const note = "Two smoke detectors in the stairwell do not work at all.";
    const dispatcher = createMockDispatcher({
      query: async () => ({ isSuccess: true, data: { count: 2, note } }),
    });
    renderForm(dispatcher, {
      ...form,
      preview: {
        query: "tasks:query:set-status-preview",
        fields: ["status"],
        facts: [
          { field: "count", label: "Affected tasks", type: "number" },
          { field: "note", label: "Note" },
        ],
      },
    });

    typeInto("status", "blocked");
    await waitFor(() => screen.getByTestId("action-form-preview"));
    const count = screen.getByTestId("action-form-preview-fact-0");
    const noteFact = screen.getByTestId("action-form-preview-fact-1");
    expect(factText("action-form-preview-fact-0")).toBe("Affected tasks2");
    expect(noteFact.parentElement).not.toBe(count.parentElement);
    expect(screen.getByTestId("action-form-preview-fact-1-line-0").textContent).toBe(note);
  });

  test("footer rows sit in the table footer under their column, formatted like the body, and the panel is no hint banner", async () => {
    const money = (amount: number) => ({ amount, currency: "EUR" });
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: {
          rows: [{ month: "2026-01", rent: money(103000), open: money(78115) }],
          sumRent: money(618000),
          sumOpen: money(593115),
          total: money(593115),
        },
      }),
    });
    renderForm(dispatcher, {
      ...form,
      preview: {
        query: "tasks:query:set-status-preview",
        fields: ["status"],
        title: "Claim",
        list: {
          field: "rows",
          columns: [
            { field: "month", label: "Month" },
            { field: "rent", label: "Rent", type: "money" },
            { field: "open", label: "Open", type: "money" },
          ],
          footer: [
            { label: "Sum", cells: { rent: "sumRent", open: "sumOpen" } },
            { label: "Total claim", cells: { open: "total" }, emphasize: true },
          ],
        },
      },
    });

    typeInto("status", "blocked");
    const panel = await screen.findByTestId("action-form-preview");
    expect(panel.querySelector("[data-section-title]")?.textContent).toBe("Claim");
    expect(screen.queryByRole("status")).toBeNull();
    const sum = screen.getByTestId("list-footer-0");
    expect(sum.closest("tfoot")).not.toBeNull();
    expect(Array.from(sum.children).map((cell) => cell.textContent)).toEqual([
      "Sum",
      "€6,180.00",
      "€5,931.15",
    ]);
    const total = screen.getByTestId("list-footer-1");
    expect(Array.from(total.children).map((cell) => cell.textContent)).toEqual([
      "Total claim",
      "",
      "€5,931.15",
    ]);
    expect(total.hasAttribute("data-emphasize")).toBe(true);
    expect(sum.hasAttribute("data-emphasize")).toBe(false);
  });

  test("a changed form value runs the preview query and renders facts and list", async () => {
    const queries: { type: string; payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      query: async (type: string, payload: unknown) => {
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
      },
    });
    renderForm(dispatcher);

    expect(queries).toEqual([]);
    typeInto("note", "ignored: not a preview field");
    typeInto("status", "blocked");

    await waitFor(() => screen.getByTestId("action-form-preview"));
    expect(queries).toEqual([
      { type: "tasks:query:set-status-preview", payload: { status: "blocked" } },
    ]);
    expect(factText("action-form-preview-fact-0")).toBe("Affected tasks2");
    screen.getByText("Quarterly VAT filing");
    screen.getByText("Prepare audit");
  });

  test("an empty list under facts shows no empty state, a list-only preview keeps it", async () => {
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: { count: 0, tasks: [] },
      }),
    });
    const { unmount } = renderForm(dispatcher);
    typeInto("status", "blocked");
    await waitFor(() => screen.getByTestId("action-form-preview-fact-0"));
    expect(screen.queryByText(/no[- ]entries/i)).toBeNull();
    unmount();

    const { facts: _facts, ...listOnly } = form.preview ?? { query: "" };
    renderForm(dispatcher, { ...form, preview: listOnly });
    typeInto("status", "blocked");
    await waitFor(() => screen.getByTestId("action-form-preview"));
    screen.getByText(/no[- ]entries/i);
  });

  test("an emptied optional field is left out of the preview payload", async () => {
    const queries: unknown[] = [];
    const dispatcher = createMockDispatcher({
      query: async (_type: string, payload: unknown) => {
        queries.push(payload);
        return { isSuccess: true, data: { count: 0, tasks: [] } };
      },
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
      query: async (_type: string, payload: unknown) => {
        queries.push(payload);
        return { isSuccess: true, data: { count: 0, tasks: [] } };
      },
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
      query: async () => ({
        isSuccess: true,
        data: {
          total: { amount: 123450, currency: "EUR" },
          dueOn: "2026-11-30",
          rows: [{ label: "Rate 1", amount: { amount: 1250, currency: "EUR" } }],
        },
      }),
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
    await waitFor(() => screen.getByTestId("action-form-preview"));
    expect(factText("action-form-preview-fact-0")).toBe("Total€1,234.50");
    const due = factText("action-form-preview-fact-1");
    expect(due).not.toContain("2026-11-30");
    expect(due).toContain("2026");
    screen.getByText("€12.50");
  });

  test("a failing preview query shows a hint and does not block the submit", async () => {
    const writes: unknown[] = [];
    const dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: false,
        error: {
          code: "internal_error",
          httpStatus: 500,
          message: "Preview is unavailable",
          i18nKey: "preview.unavailable",
        },
      }),
      write: async (_type: string, payload: unknown) => {
        writes.push(payload);
        return { isSuccess: true, data: {} };
      },
    });
    renderForm(dispatcher);

    typeInto("status", "blocked");
    await waitFor(() => screen.getByTestId("action-form-preview-error"));
    expect(screen.getByTestId("action-form-preview-error").textContent).toContain(
      "Preview is unavailable",
    );

    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes).toEqual([{ status: "blocked" }]));
  });

  test("a file fact lists the stored file with name and download link", async () => {
    const attachmentId = "11111111-2222-4333-8444-555555555555";
    clearFileMetaCache();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (!String(input).startsWith("/api/files/meta?ids=")) {
        return new Response("not found", { status: 404 });
      }
      const files = [
        { id: attachmentId, fileName: "Mahnung.pdf", mimeType: "application/pdf", size: 1 },
      ];
      return new Response(JSON.stringify({ files }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const dispatcher = createMockDispatcher({
        query: async () => ({
          isSuccess: true,
          data: { attachment: attachmentId, missing: null },
        }),
      });
      renderForm(dispatcher, {
        ...form,
        preview: {
          query: "tasks:query:set-status-preview",
          fields: ["status"],
          facts: [
            { field: "attachment", label: "Attachment", type: "file" },
            { field: "missing", label: "Other", type: "file" },
          ],
        },
      });

      typeInto("status", "blocked");
      await screen.findByText("Mahnung.pdf");
      expect(
        screen
          .getByTestId(`action-form-preview-fact-0-files-${attachmentId}-download`)
          .getAttribute("href"),
      ).toBe(`/api/files/${attachmentId}`);
      expect(screen.queryByTestId("action-form-preview-fact-1")).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
      clearFileMetaCache();
    }
  });
});
