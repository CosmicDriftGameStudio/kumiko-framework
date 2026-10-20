// A record action on a projectionDetail must show the changed record without a reload.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "rent-detail",
  type: "projectionDetail",
  query: "rentals:query:rent:detail",
  idParam: "id",
  layout: { sections: [{ title: "Rent", fields: ["state"] }] },
  fieldLabels: { state: "rentals.detail.state" },
  actions: [
    {
      kind: "writeHandler",
      id: "terminate",
      label: "rentals.actions.terminate",
      handler: "rentals:write:rent:terminate",
    },
  ],
};

const schema: FeatureSchema = { featureName: "rentals", entities: {}, screens: [detailScreen] };

describe("projectionDetail record action", () => {
  test("shows the changed field after the action without a reload", async () => {
    let state = "active";
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "rent-1", state },
      })) as unknown as Dispatcher["query"],
      write: (async () => {
        state = "terminated";
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="rentals:screen:rent-detail" entityId="rent-1" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("field-value-state").textContent).toBe("active"));

    await userEvent.setup().click(screen.getByTestId("render-edit-action-terminate"));

    await waitFor(() =>
      expect(screen.getByTestId("field-value-state").textContent).toBe("terminated"),
    );
  });
});
