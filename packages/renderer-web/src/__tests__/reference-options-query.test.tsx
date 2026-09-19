// fw#2780: a reference field whose target has no readable column sources its
// picker options from a query handler instead of the target's list handler.
// The rows carry a composed `label`; `labelField` stays untouched (it still
// drives list cells and the SQL search/sort paths).

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider, RenderEdit } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const LEASE_ID = "11111111-1111-4111-8111-111111111111";

const depositEntity = {
  fields: {
    leaseId: {
      type: "reference",
      entity: "lease",
      labelField: "startDate",
      optionsQuery: "deposits:query:lease:options",
    },
    reviewedLeaseId: {
      type: "reference",
      entity: "lease",
      labelField: "startDate",
      optionsQuery: "deposits:query:lease:options",
    },
  },
} as unknown as EntityDefinition;

const depositScreen: EntityEditScreenDefinition = {
  id: "deposit-edit",
  type: "entityEdit",
  entity: "deposit",
  layout: {
    sections: [{ fields: ["leaseId", { field: "reviewedLeaseId", readOnly: true }] }],
  },
};

function makeDispatcher(): Dispatcher & { readonly queried: string[] } {
  const queried: string[] = [];
  const dispatcher = createMockDispatcher({
    query: (async (qn: string) => {
      queried.push(qn);
      if (qn === "deposits:query:lease:options") {
        return {
          isSuccess: true,
          data: { rows: [{ id: LEASE_ID, label: "Max Nachmieter · WE-12 · Haus Ahornweg" }] },
        };
      }
      return { isSuccess: true, data: { rows: [{ id: LEASE_ID, startDate: "2026-09-01" }] } };
    }) as unknown as Dispatcher["query"],
  });
  return { ...dispatcher, queried };
}

const noopSubmit = async (): Promise<{
  readonly isSuccess: true;
  readonly validationBlocked: false;
  readonly data: undefined;
}> => ({ isSuccess: true, validationBlocked: false, data: undefined });

describe("reference optionsQuery (fw#2780)", () => {
  test("picker options come from the declared handler and show its composed label", async () => {
    const user = userEvent.setup();
    const dispatcher = makeDispatcher();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit
          screen={depositScreen}
          entity={depositEntity}
          featureName="deposits"
          initial={{}}
          customSubmit={noopSubmit}
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    await user.click(screen.getByTestId("combobox-kumiko-edit-leaseId"));

    expect(await screen.findByText("Max Nachmieter · WE-12 · Haus Ahornweg")).toBeDefined();
    // The entity's own list handler is never asked for this field — that is
    // the whole point, its rows have no readable column.
    expect(dispatcher.queried).not.toContain("deposits:query:lease:list");
  });

  test("read-only display resolves through the same handler, not through labelField", async () => {
    const dispatcher = makeDispatcher();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit
          screen={depositScreen}
          entity={depositEntity}
          featureName="deposits"
          initial={{ reviewedLeaseId: LEASE_ID }}
          customSubmit={noopSubmit}
          valueDisplay="text"
        />
      </DispatcherProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("field-value-reviewedLeaseId").textContent).toBe(
        "Max Nachmieter · WE-12 · Haus Ahornweg",
      ),
    );
  });
});
