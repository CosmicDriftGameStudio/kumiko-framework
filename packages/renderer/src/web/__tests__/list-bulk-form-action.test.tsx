import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import { useListBulk } from "../../app/list-bulk-actions.ts";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const columns = [{ field: "name", label: "Name", type: "string" as const, sortable: false }];
const rows = [
  { id: "p1", values: { id: "p1", name: "Elm Street 1" } },
  { id: "p2", values: { id: "p2", name: "Elm Street 2" } },
  { id: "p3", values: { id: "p3", name: "Elm Street 3" } },
  { id: "p4", values: { id: "p4", name: "Oak Avenue 9" } },
];

const swapForm: ActionFormScreenDefinition = {
  id: "swap-company",
  type: "actionForm",
  handler: "props:write:swap-company",
  fields: {
    propertyIds: { type: "multiSelect", options: [], display: "count" },
    company: { type: "text", required: true },
  },
  layout: { sections: [{ fields: ["propertyIds", "company"] }] },
};

function ListThenForm({ dispatcher }: { readonly dispatcher: Dispatcher }): ReactNode {
  const [screenId, setScreenId] = useState("property-list");
  return (
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId },
          navigate: (target) => setScreenId("screenId" in target ? target.screenId : screenId),
          replace: () => {},
          hrefFor: () => "",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        {screenId === "property-list" ? (
          <BulkList dispatcher={dispatcher} />
        ) : (
          <KumikoScreen
            schema={{ featureName: "props", entities: {}, screens: [swapForm] }}
            qn="props:screen:swap-company"
          />
        )}
      </NavProvider>
    </DispatcherProvider>
  );
}

function BulkList({ dispatcher }: { readonly dispatcher: Dispatcher }): ReactNode {
  const bulk = useListBulk({
    bulkActions: [
      {
        id: "swap-company",
        label: "Swap company",
        screen: "swap-company",
        idsField: "propertyIds",
      },
    ],
    rowActions: undefined,
    translate: (key) => key,
    dispatcher,
    reload: async () => {},
  });
  return <DataTable columns={columns} rows={rows} testId="t" {...(bulk && { bulk })} />;
}

describe("list bulk form action", () => {
  test("three selected rows open the form with three ids and submit calls the handler once", async () => {
    const calls: { type: string; payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      write: (async (type: string, payload: unknown) => {
        calls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    render(<ListThenForm dispatcher={dispatcher} />);

    for (const id of ["p1", "p2", "p4"]) fireEvent.click(screen.getByTestId(`row-${id}-select`));
    fireEvent.click(screen.getByTestId("bulk-action-swap-company"));

    await waitFor(() => expect(screen.getByTestId("kumiko-edit-propertyIds-count")).toBeTruthy());
    expect(screen.getByTestId("kumiko-edit-propertyIds-count").textContent).toBe("3 selected");

    fireEvent.change(document.querySelector("#kumiko-edit-company") as HTMLInputElement, {
      target: { value: "Acme Facility" },
    });
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      type: "props:write:swap-company",
      payload: { propertyIds: ["p1", "p2", "p4"], company: "Acme Facility" },
    });
  });
});
