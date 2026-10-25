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
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const GATE_QUERY = "billing:query:case:access";
const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const detail: ScreenDefinition = {
  id: "case-detail",
  type: "projectionDetail",
  query: "billing:query:case:detail",
  access: OPEN,
  layout: { sections: [{ title: "s", fields: ["name"] }] },
  visibleWhen: { query: GATE_QUERY, field: "allowed", eq: true, idParam: "caseId" },
};

const schema: FeatureSchema = { featureName: "billing", entities: {}, screens: [detail] };

type Gate = "allowed" | "error";

function renderDetail(gate: Gate, entityId: string | undefined) {
  const gatePayloads: unknown[] = [];
  const dispatcher = createMockDispatcher({
    query: (async (type: string, payload: unknown) => {
      if (type === GATE_QUERY) {
        gatePayloads.push(payload);
        return gate === "error"
          ? {
              isSuccess: false,
              error: { code: "forbidden", message: "no", i18nKey: "errors.forbidden" },
            }
          : { isSuccess: true, data: { allowed: true } };
      }
      return { isSuccess: true, data: { id: "c1", name: "CASE NAME" } };
    }) as unknown as Dispatcher["query"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[schema]}>
        <UserRolesProvider roles={["User"]}>
          <KumikoScreen
            schema={schema}
            qn="billing:screen:case-detail"
            {...(entityId !== undefined && { entityId })}
          />
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>,
  );
  return { gatePayloads };
}

describe("screen visibleWhen.idParam", () => {
  test("the gate query receives the route id under idParam", async () => {
    const { gatePayloads } = renderDetail("allowed", "case-42");
    await waitFor(() => expect(screen.getByText("CASE NAME")).toBeTruthy());
    expect(gatePayloads[0]).toEqual({ caseId: "case-42" });
  });

  test("a failing gate query (403) shows the unavailable notice, not the record", async () => {
    renderDetail("error", "case-42");
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-unavailable")).toBeTruthy());
    expect(screen.queryByText("CASE NAME")).toBeNull();
  });

  test("without a route id the gate is not queried and the screen counts as hidden", async () => {
    const { gatePayloads } = renderDetail("allowed", undefined);
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-unavailable")).toBeTruthy());
    expect(gatePayloads).toEqual([]);
  });
});
