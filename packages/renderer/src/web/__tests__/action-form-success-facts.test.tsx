import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const RUN: ActionFormScreenDefinition = {
  id: "run",
  type: "actionForm",
  handler: "demo:write:run",
  fields: { name: { type: "text", required: true } },
  layout: { sections: [{ fields: ["name"] }] },
  successFacts: [
    { field: "charged", label: "demo.fact.charged" },
    { field: "failed", label: "demo.fact.failed" },
    { field: "missing", label: "demo.fact.missing" },
  ],
} as unknown as ActionFormScreenDefinition;

const SCHEMA: FeatureSchema = {
  featureName: "demo",
  entities: {},
  screens: [RUN] as unknown as FeatureSchema["screens"],
};

const LABELS: Readonly<Record<string, string>> = {
  "demo.fact.charged": "Charged",
  "demo.fact.failed": "Failed",
  "demo.fact.missing": "Missing",
};

function dispatcherReturning(data: Record<string, unknown>): Dispatcher {
  return createMockDispatcher({
    write: (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["write"],
  });
}

describe("actionForm successFacts", () => {
  test("shows payload figures and lists after submit, hides absent fields", async () => {
    render(
      <DispatcherProvider
        dispatcher={dispatcherReturning({ charged: 12, failed: ["Lease A", { label: "Lease B" }] })}
      >
        <NavProvider
          value={{
            route: { screenId: "demo:screen:run" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "#",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <KumikoScreen
            schema={SCHEMA}
            qn="demo:screen:run"
            translate={(key) => LABELS[key] ?? key}
          />
        </NavProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    const input = screen.getByTestId("field-name").querySelector("input");
    if (!input) throw new Error("expected a name input");
    const user = userEvent.setup();
    await user.type(input, "x");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(screen.getByTestId("action-form-success-fact-0")).toBeTruthy());
    expect(screen.getByTestId("action-form-success-fact-0").textContent).toBe("Charged: 12");
    expect(screen.getByTestId("action-form-success-fact-1").textContent).toBe(
      "Failed: Lease A, Lease B",
    );
    expect(screen.queryByTestId("action-form-success-fact-2")).toBeNull();
  });
});
