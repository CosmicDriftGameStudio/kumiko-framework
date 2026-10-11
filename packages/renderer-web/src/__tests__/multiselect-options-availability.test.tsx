// A multiSelect field with `optionsAvailabilityQuery` hides the options the query
// marks disabled, unless the value is already selected. The write path enforces
// the rule, so until the result arrives every static option is offered.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const AVAILABILITY_QUERY = "demo:query:role-availability";

function rolesScreen(display?: "checkboxes"): ActionFormScreenDefinition {
  return {
    id: "set-roles",
    type: "actionForm",
    handler: "demo:write:member:set-roles",
    fields: {
      roles: {
        type: "multiSelect",
        options: ["User", "Admin", "TenantAdmin"],
        optionsAvailabilityQuery: AVAILABILITY_QUERY,
        ...(display !== undefined && { display }),
      },
    },
    layout: { sections: [{ fields: ["roles"] }] },
  };
}

function schemaFor(display?: "checkboxes"): FeatureSchema {
  return { featureName: "demo", entities: {}, screens: [rolesScreen(display)] };
}

function dispatcherWith(query: Dispatcher["query"]): Dispatcher {
  return createMockDispatcher({ query });
}

const availabilityRows = {
  isSuccess: true,
  data: {
    rows: [
      { value: "User", disabled: false },
      { value: "Admin", disabled: false },
      { value: "TenantAdmin", disabled: true, hint: "ignored for multiSelect" },
    ],
  },
};

describe("multiSelect optionsAvailabilityQuery", () => {
  test("combobox drops the disabled option once the query answered", async () => {
    const user = userEvent.setup();
    const dispatcher = dispatcherWith(
      (async () => availabilityRows) as unknown as Dispatcher["query"],
    );
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schemaFor()} qn="demo:screen:set-roles" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("combobox-kumiko-edit-roles"));
    await user.click(screen.getByTestId("combobox-kumiko-edit-roles"));
    await waitFor(() => expect(screen.queryByText("TenantAdmin")).toBeNull());
    expect(screen.getByText("User")).toBeDefined();
    expect(screen.getByText("Admin")).toBeDefined();
  });

  test("checkbox grid drops the disabled option too", async () => {
    const dispatcher = dispatcherWith(
      (async () => availabilityRows) as unknown as Dispatcher["query"],
    );
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schemaFor("checkboxes")} qn="demo:screen:set-roles" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByText("TenantAdmin")).toBeNull());
    expect(screen.getByText("User")).toBeDefined();
    expect(screen.getByText("Admin")).toBeDefined();
  });

  test("a failing query leaves every static option", async () => {
    const dispatcher = dispatcherWith((async () => ({
      isSuccess: false,
      error: { code: "internal", message: "boom" },
    })) as unknown as Dispatcher["query"]);
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schemaFor("checkboxes")} qn="demo:screen:set-roles" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByText("User")).toBeDefined());
    expect(screen.getByText("TenantAdmin")).toBeDefined();
  });
});
