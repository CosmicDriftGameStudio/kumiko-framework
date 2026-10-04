import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const TIER_ACTION_FORM = {
  id: "tier-admin",
  type: "actionForm",
  handler: "tier-engine:write:set-tenant-tier",
  fields: {
    tenantId: { type: "reference", entity: "tenant:tenant", labelField: "name", required: true },
    note: { type: "text" },
  },
  layout: { sections: [{ fields: ["tenantId", "note"] }] },
  urlPrefillFields: ["tenantId"],
  successMessage: "tier-admin.success",
} as unknown as ActionFormScreenDefinition;

function schemaWith(screenDefinition: ActionFormScreenDefinition): FeatureSchema {
  return { featureName: "tier-engine", entities: {}, screens: [screenDefinition] };
}

function dispatcherWith(handlerResult: "ok" | "rejected"): Dispatcher {
  return createMockDispatcher({
    query: (async (type: string) =>
      type === "tenant:query:tenant-directory"
        ? {
            isSuccess: true,
            data: {
              rows: [
                { id: "t-1", label: "Demo" },
                { id: "t-2", label: "PublicStatus.eu" },
              ],
              nextCursor: null,
            },
          }
        : {
            isSuccess: true,
            data: { rows: [], nextCursor: null },
          }) as unknown as Dispatcher["query"],
    write: (async () =>
      handlerResult === "ok"
        ? { isSuccess: true, data: {} }
        : {
            isSuccess: false,
            error: { code: "validation", message: "no", details: { fields: [] } },
          }) as unknown as Dispatcher["write"],
  });
}

function renderScreen(
  screenDefinition: ActionFormScreenDefinition,
  handlerResult: "ok" | "rejected" = "ok",
) {
  return render(
    <DispatcherProvider dispatcher={dispatcherWith(handlerResult)}>
      <NavProvider
        value={{
          route: { screenId: "tier-engine:screen:tier-admin" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams: { tenantId: "t-2" },
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={schemaWith(screenDefinition)}
          qn="tier-engine:screen:tier-admin"
          translate={(key, params) =>
            key === "tier-admin.success"
              ? `Assigned: ${params?.["tenantId"]} / ${params?.["note"]}`
              : key
          }
        />
      </NavProvider>
    </DispatcherProvider>,
  );
}

async function submitWithNote(): Promise<void> {
  const user = userEvent.setup();
  const input = screen.getByTestId("field-note").querySelector("input");
  if (!input) throw new Error("expected a note input");
  await user.type(input, "granted");
  await user.click(screen.getByTestId("render-edit-submit"));
}

describe("actionForm successMessage", () => {
  test("names the chosen record's label, not its id, after a successful submit", async () => {
    renderScreen(TIER_ACTION_FORM);
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await submitWithNote();

    await waitFor(() =>
      expect(screen.getByTestId("action-form-success").textContent).toBe(
        "Assigned: PublicStatus.eu / granted",
      ),
    );
  });

  test("shows no message when the handler rejects the submit", async () => {
    renderScreen(TIER_ACTION_FORM, "rejected");
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await submitWithNote();

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(screen.queryByTestId("action-form-success")).toBeNull();
  });

  test("shows no message when the screen declares none", async () => {
    renderScreen({ ...TIER_ACTION_FORM, successMessage: undefined });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await submitWithNote();

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(screen.queryByTestId("action-form-success")).toBeNull();
  });
});
