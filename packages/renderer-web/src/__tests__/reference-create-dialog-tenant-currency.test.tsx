// The inline reference-create dialog seeds a `currency: { kind: "tenant" }`
// money field from the tenant-settings currency, same as the entityEdit
// create screen (fw#2933) — not from entity.defaultCurrency.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { ReferenceCreateDialog } from "../../../renderer/src/components/reference-create-dialog.js";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const invoiceEntity = {
  defaultCurrency: "EUR",
  fields: {
    price: { type: "money", currency: { kind: "tenant" } },
    cost: { type: "money" },
  },
} as unknown as EntityDefinition;

const createScreen: EntityEditScreenDefinition = {
  id: "invoice-create",
  type: "entityEdit",
  entity: "invoice",
  layout: { sections: [{ fields: ["price", "cost"] }] },
};

describe("ReferenceCreateDialog — tenant-declared money currency", () => {
  test("untouched tenant-declared field submits with the tenant currency, not EUR", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (type: string) =>
        type === "config:query:values"
          ? {
              isSuccess: true,
              data: {
                "tenant-settings:config:currency": {
                  value: "GBP",
                  scope: "tenant",
                  source: "tenant-row",
                },
              },
            }
          : {
              isSuccess: true,
              data: { rows: [], nextCursor: null },
            }) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "inv-1" } };
      }) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ReferenceCreateDialog
          open
          onClose={() => undefined}
          onCreated={() => undefined}
          featureName="billing"
          screen={createScreen}
          entity={invoiceEntity}
        />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy(), {
      timeout: 3000,
    });
    const costInput = screen.getByTestId("field-cost").querySelector("input");
    if (!costInput) throw new Error("expected an <input> inside field-cost");
    const user = userEvent.setup();
    await user.clear(costInput);
    await user.type(costInput, "20.00");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const payload = writeCalls[0]?.payload as { price?: unknown; cost?: unknown };
    expect(payload.price).toEqual({ amount: 0, currency: "GBP" });
    expect(payload.cost).toEqual({ amount: 20, currency: "EUR" });
  });
});
