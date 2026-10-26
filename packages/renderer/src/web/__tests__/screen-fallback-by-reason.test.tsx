// Screen-level fallback map: the closed gate picks the fallback screen by failure reason.

import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  KumikoScreen,
  UserRolesProvider,
} from "../../index.ts";
import { act, createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const GATE_QUERY = "billing:query:case:access";
const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const detail: ScreenDefinition = {
  id: "case-detail",
  type: "projectionDetail",
  query: "billing:query:case:detail",
  access: OPEN,
  layout: { sections: [{ title: "s", fields: ["name"] }] },
  visibleWhen: { query: GATE_QUERY, field: "allowed", eq: true, idParam: "caseId" },
  fallback: { forbidden: "no-access", notFound: "gone" },
};

const noAccess: ScreenDefinition = {
  id: "no-access",
  type: "projectionList",
  query: "billing:query:case:list",
  access: OPEN,
  columns: [{ field: "label", label: "billing.col.label" }],
};
const gone: ScreenDefinition = { ...noAccess, id: "gone" };

const schema: FeatureSchema = {
  featureName: "billing",
  entities: {},
  screens: [detail, noAccess, gone],
};

type Gate = { readonly httpStatus: number } | { readonly allowed: boolean };

function renderDetail(gate: Gate, onGateRefetch?: () => void) {
  const dispatcher = createMockDispatcher({
    query: (async (type: string) => {
      if (type === GATE_QUERY) {
        onGateRefetch?.();
        return "httpStatus" in gate
          ? {
              isSuccess: false,
              error: {
                code: "failed",
                message: "gate failed",
                i18nKey: "errors.internal",
                httpStatus: gate.httpStatus,
              },
            }
          : { isSuccess: true, data: gate };
      }
      if (type === "billing:query:case:list") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "x", label: "LIST ROW" }], nextCursor: null },
        };
      }
      return { isSuccess: true, data: { id: "c1", name: "CASE NAME" } };
    }) as unknown as Dispatcher["query"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[schema]}>
        <UserRolesProvider roles={["User"]}>
          <KumikoScreen schema={schema} qn="billing:screen:case-detail" entityId="case-42" />
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>,
  );
}

describe("screen fallback by reason", () => {
  test("403 on the gate renders the forbidden fallback screen", async () => {
    renderDetail({ httpStatus: 403 });
    await waitFor(() => expect(screen.getByText("LIST ROW")).toBeTruthy());
    expect(screen.queryByText("CASE NAME")).toBeNull();
  });

  test("404 on the gate renders the notFound fallback screen", async () => {
    renderDetail({ httpStatus: 404 });
    await waitFor(() => expect(screen.getByText("LIST ROW")).toBeTruthy());
  });

  test("an unmet condition without a hidden entry shows the default notice", async () => {
    renderDetail({ allowed: false });
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-unavailable")).toBeTruthy());
    expect(screen.queryByText("LIST ROW")).toBeNull();
  });

  test("another failure without an error entry shows the error banner and retry refetches the gate", async () => {
    let gateCalls = 0;
    renderDetail({ httpStatus: 500 }, () => {
      gateCalls++;
    });
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-error")).toBeTruthy());
    expect(screen.queryByText("LIST ROW")).toBeNull();
    const before = gateCalls;
    await act(async () => {
      screen.getByTestId("kumiko-screen-retry").click();
    });
    await waitFor(() => expect(gateCalls).toBeGreaterThan(before));
  });
});
