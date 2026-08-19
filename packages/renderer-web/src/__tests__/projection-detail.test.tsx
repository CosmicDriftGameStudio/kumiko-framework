// Unit-Tests für den projectionDetail-Screen-Type (read-only single-row
// inspector, kumiko-framework#255). Deckt den Pfad ab, der Integration/E2E
// nicht prüft (e2e-generator skippt projectionDetail explizit — kein CRUD):
//   - Row wird über idParam gefetcht, Felder zeigen die Query-Response-Werte
//   - jedes Feld ist readOnly, kein Submit-Button (hasEditableSection=false)
//   - fehlende entityId → Error-Banner statt Crash

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema, NavApi, NavTarget } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

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
    // fw#2245: projectionDetail defaults to text display — a readOnly field
    // renders its value as plain text, not a disabled Input.
    expect(screen.getByTestId("field-userId").textContent).toContain("user-42");
    expect(screen.getByTestId("field-userId").querySelector("input")).toBeNull();

    // hasEditableSection() reads readOnly on every field — projectionDetail
    // forces it hard in the shim, so RenderEdit must never draw a Save button.
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
  });

  // fw#2245 Teil 4: synthesizeProjectionDetailEntity (projection-detail-shim.ts)
  // stamps every field as type:"text" — the shim has no access to the query's
  // real field types. field.renderer (Teil 1) is the only way this screen
  // type reaches real per-type formatting; without it a timestamp field would
  // render its raw ISO string. Mirrors the sessions bundled feature's actual
  // session-detail screen (feature.ts).
  test("field.renderer formats a value past the shim's synthesized type:'text' field", async () => {
    const timestampScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      layout: {
        sections: [
          {
            title: "Session",
            fields: ["userId", { field: "createdAt", renderer: { format: "timestamp" } }],
          },
        ],
      },
    };
    const timestampSchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [timestampScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={timestampSchema}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const rendered = screen.getByTestId("field-value-createdAt").textContent;
    expect(rendered).not.toBe("2026-07-01T00:00:00Z");
    expect(rendered).not.toBe("");
  });

  // synthesizeProjectionDetailScreen rebuilds `layout` from `sections` alone
  // (structural readOnly:true proof) — a naive rebuild would drop sibling
  // layout fields like `width` (#1676).
  test("layout.width survives the projectionDetail → entityEdit shim", async () => {
    const wideDetailScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      layout: { ...detailScreen.layout, width: "full" },
    };
    const wideSchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [wideDetailScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={wideSchema} qn="sessions:screen:session-detail" entityId="sess-1" />
      </DispatcherProvider>,
    );

    const form = await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(form.firstElementChild?.className).toContain("max-w-full");
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

  // fw#2245: a projectionDetail has no write path — its footer is Cancel-only
  // and defaults to shown (pre-fw#2245 behavior) so existing screens without
  // an explicit opt-in keep working; `hideActions: true` turns it off without
  // losing back-navigation (shell-breadcrumb.ts also resolves listScreenId
  // for this screen type, independent of the footer — see shell-breadcrumb.test.ts).
  test("shows Cancel by default when listScreenId is set", async () => {
    const withListScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      listScreenId: "session-list",
    };
    const withListSchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [withListScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={withListSchema}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-cancel"));
  });

  test("hideActions:true hides the Cancel button", async () => {
    const hiddenActionsScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      listScreenId: "session-list",
      hideActions: true,
    };
    const hiddenActionsSchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [hiddenActionsScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={hiddenActionsSchema}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.queryByTestId("render-edit-cancel")).toBeNull();
  });

  test("valueDisplay:'form' opts back into the disabled-Input look", async () => {
    const formDisplayScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      valueDisplay: "form",
    };
    const formDisplaySchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [formDisplayScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={formDisplaySchema}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const userIdInput = screen.getByTestId("field-userId").querySelector("input");
    expect(userIdInput?.value).toBe("user-42");
    expect(userIdInput?.disabled).toBe(true);
  });
});

// fw#2166: `relatedList` sections run their own query against the shown
// record's id, independent of the detail query above.
describe("KumikoScreen / projectionDetail relatedList section (fw#2166)", () => {
  const relatedListSection = {
    kind: "relatedList" as const,
    title: "Payments",
    query: "sessions:query:user-session:payments",
    columns: [{ field: "amount", label: "Amount" }],
    rowClick: { entity: "payment" },
  };

  const detailScreenWithRelatedList: ProjectionDetailScreenDefinition = {
    ...detailScreen,
    layout: { sections: [...detailScreen.layout.sections, relatedListSection] },
  };

  const relatedListSchema: FeatureSchema = {
    featureName: "sessions",
    entities: {},
    screens: [detailScreenWithRelatedList],
  };

  function makeRelatedListDispatcher(paymentsRows: readonly Readonly<Record<string, unknown>>[]): {
    readonly dispatcher: Dispatcher;
    readonly calls: { readonly type: string; readonly payload: unknown }[];
  } {
    const calls: { type: string; payload: unknown }[] = [];
    const query = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      if (type === "sessions:query:user-session:detail") {
        return {
          isSuccess: true,
          data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
        };
      }
      return { isSuccess: true, data: { rows: paymentsRows, nextCursor: null } };
    }) as unknown as Dispatcher["query"];
    return { dispatcher: createMockDispatcher({ query }), calls };
  }

  test("runs its own query with the route entityId under the default `id` parentParam, renders its rows, and leaves the parent's own fields read-only", async () => {
    const { dispatcher, calls } = makeRelatedListDispatcher([{ id: "pay-1", amount: "42" }]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={relatedListSchema}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("row-pay-1"));

    // The shim's isFieldsEditSection flip must not regress the structural
    // readOnly proof from the first test above.
    expect(screen.getByTestId("field-userId").querySelector("input")).toBeNull();
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();

    const relatedCall = calls.find((c) => c.type === "sessions:query:user-session:payments");
    expect(relatedCall?.payload).toEqual({ id: "sess-1" });
    expect(screen.getByTestId("cell-pay-1-amount").textContent).toBe("42");
  });

  test("a custom parentParam sends the route entityId under that key instead of `id`", async () => {
    const customParamScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      layout: {
        sections: [
          ...detailScreen.layout.sections,
          { ...relatedListSection, parentParam: "sessionId" },
        ],
      },
    };
    const customParamSchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [customParamScreen],
    };
    const { dispatcher, calls } = makeRelatedListDispatcher([]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={customParamSchema}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() =>
      expect(calls.some((c) => c.type === "sessions:query:user-session:payments")).toBe(true),
    );
    const relatedCall = calls.find((c) => c.type === "sessions:query:user-session:payments");
    expect(relatedCall?.payload).toEqual({ sessionId: "sess-1" });
  });

  test("clicking a row with rowClick set navigates with the exact ObjectTarget", async () => {
    const { dispatcher } = makeRelatedListDispatcher([{ id: "pay-1", amount: "42" }]);
    let navigated: NavTarget | undefined;
    const navApi: NavApi = {
      route: undefined,
      navigate: (target) => {
        navigated = target;
      },
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };

    render(
      <NavProvider value={navApi}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={relatedListSchema}
            qn="sessions:screen:session-detail"
            entityId="sess-1"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const row = await waitFor(() => screen.getByTestId("row-pay-1"));
    fireEvent.click(row);

    expect(navigated).toEqual({ entity: "payment", id: "pay-1" });
  });

  test("without rowClick, clicking a row does not navigate", async () => {
    const noRowClickScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      layout: {
        sections: [
          ...detailScreen.layout.sections,
          {
            kind: "relatedList",
            title: "Payments",
            query: "sessions:query:user-session:payments",
            columns: [{ field: "amount", label: "Amount" }],
          },
        ],
      },
    };
    const noRowClickSchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [noRowClickScreen],
    };
    const { dispatcher } = makeRelatedListDispatcher([{ id: "pay-1", amount: "42" }]);
    let navigated: NavTarget | undefined;
    const navApi: NavApi = {
      route: undefined,
      navigate: (target) => {
        navigated = target;
      },
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };

    render(
      <NavProvider value={navApi}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={noRowClickSchema}
            qn="sessions:screen:session-detail"
            entityId="sess-1"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const row = await waitFor(() => screen.getByTestId("row-pay-1"));
    fireEvent.click(row);

    expect(navigated).toBeUndefined();
  });
});
