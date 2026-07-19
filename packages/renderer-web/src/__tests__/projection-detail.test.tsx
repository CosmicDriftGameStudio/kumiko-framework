// Unit-Tests für den projectionDetail-Screen-Type (read-only single-row
// inspector, kumiko-framework#255). Deckt den Pfad ab, der Integration/E2E
// nicht prüft (e2e-generator skippt projectionDetail explizit — kein CRUD):
//   - Row wird über idParam gefetcht, Felder zeigen die Query-Response-Werte
//   - jedes Feld ist readOnly, kein Submit-Button (hasEditableSection=false)
//   - fehlende entityId → Error-Banner statt Crash

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import { act, createMockDispatcher, render, screen, waitFor } from "./test-utils";

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "session-detail",
  type: "projectionDetail",
  query: "sessions:query:user-session:detail",
  idParam: "id",
  layout: {
    sections: [{ title: "Session", fields: ["userId", "createdAt"] }],
  },
  fieldLabels: {
    userId: "sessions.detail.field.userId",
    createdAt: "sessions.detail.field.createdAt",
  },
};

const schema: FeatureSchema = {
  featureName: "sessions",
  entities: {},
  screens: [detailScreen],
};

describe("KumikoScreen / projectionDetail", () => {
  test("fetches the row via idParam and renders its fields read-only, no submit button", async () => {
    const querySpy = (async (_qn: string, payload: unknown) => {
      expect(payload).toEqual({ id: "sess-1" });
      return {
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      };
    }) as unknown as Dispatcher["query"];
    const dispatcher: Dispatcher = createMockDispatcher({ query: querySpy });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="sessions:screen:session-detail" entityId="sess-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const userIdInput = screen.getByTestId("field-userId").querySelector("input");
    expect(userIdInput?.value).toBe("user-42");
    expect(userIdInput?.disabled).toBe(true);

    // hasEditableSection() reads readOnly on every field — projectionDetail
    // forces it hard in the shim, so RenderEdit must never draw a Save button.
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
  });

  test("missing entityId shows an error banner instead of crashing", async () => {
    let resolveQuery: (value: unknown) => void = () => {};
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (() =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="sessions:screen:session-detail" />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("kumiko-screen-projection-detail-missing-id")).toBeTruthy();

    // Screen skips the record entirely without entityId, but useQuery's
    // effect still fired (unconditional hook call) — settle it so its async
    // setState doesn't land after the test unmounts.
    await act(async () => {
      resolveQuery({ isSuccess: true, data: {} });
      await Promise.resolve();
    });
  });

  test("record not found shows an error banner", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="sessions:screen:session-detail" entityId="sess-missing" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("kumiko-screen-record-missing"));
  });
});
