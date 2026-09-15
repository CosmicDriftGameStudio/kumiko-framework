// fw#2933: a `money` field declaring `currency: { kind: "tenant" }` resolves
// its empty-value currency from the tenant-settings config key
// (`tenant-settings:config:currency`) via `config:query:values`, instead of
// entity.defaultCurrency ?? "EUR". A stored value always keeps its own
// currency, and a field without the declaration is unaffected.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

// `price` opts into the tenant-settings currency; `cost`/`fee` don't and
// keep today's entity.defaultCurrency ("EUR") fallback.
const invoiceEntity = {
  defaultCurrency: "EUR",
  fields: {
    price: { type: "money", currency: { kind: "tenant" } },
    cost: { type: "money" },
    fee: { type: "money" },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "invoice-edit",
  type: "entityEdit",
  entity: "invoice",
  layout: { sections: [{ fields: ["price", "cost", "fee"] }] },
};

const schema: FeatureSchema = {
  featureName: "billing",
  entities: { invoice: invoiceEntity },
  screens: [editScreen],
};

const TENANT_CURRENCY_VALUES = {
  "tenant-settings:config:currency": { value: "GBP", scope: "tenant", source: "tenant-row" },
};

function makeDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher {
  const base = createMockDispatcher({
    query: (async (type: string) => {
      if (type === "billing:query:invoice:detail") {
        return {
          isSuccess: true,
          data: {
            id: "inv-1",
            version: 4,
            price: null,
            cost: { amount: 50, currency: "EUR" },
            fee: null,
          },
        };
      }
      if (type === "config:query:values") {
        return { isSuccess: true, data: TENANT_CURRENCY_VALUES };
      }
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    }) as unknown as Dispatcher["query"],
  });
  return { ...base, ...overrides };
}

async function typeMoney(testId: string, amount: string): Promise<void> {
  const input = screen.getByTestId(testId).querySelector("input");
  if (!input) throw new Error(`expected an <input> inside ${testId}`);
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, amount);
}

describe("money field currency: { kind: 'tenant' } (fw#2933)", () => {
  test("update: empty tenant-declared field uses the tenant currency; stored value keeps its own currency; undeclared empty field keeps entity.defaultCurrency", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "inv-1" } };
      }) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="billing:screen:invoice-edit" entityId="inv-1" />
      </DispatcherProvider>,
    );

    // Two sequential real async stages (detail, then tenant-currency) — the
    // default 1000ms waitFor timeout flakes under load (render-edit.test.tsx
    // uses the same 3000ms bump for comparable multi-stage async waits).
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull(), {
      timeout: 3000,
    });
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();

    await typeMoney("field-price", "10.00");
    await typeMoney("field-cost", "75.00");
    await typeMoney("field-fee", "5.00");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const [call] = writeCalls;
    expect(call?.type).toBe("billing:write:invoice:update");
    expect(call?.payload).toEqual({
      id: "inv-1",
      version: 4,
      changes: {
        price: { amount: 10, currency: "GBP" },
        cost: { amount: 75, currency: "EUR" },
        fee: { amount: 5, currency: "EUR" },
      },
    });
  });

  test("create: untouched tenant-declared field submits with the tenant currency, not EUR", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "inv-2" } };
      }) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="billing:screen:invoice-edit" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull(), {
      timeout: 3000,
    });
    // The submit button stays disabled while the form is pristine — touch an
    // unrelated field so the click below actually fires; `price` itself is
    // deliberately left untouched to prove its initial value already carries
    // the tenant currency.
    await typeMoney("field-cost", "20.00");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const [call] = writeCalls;
    expect(call?.type).toBe("billing:write:invoice:create");
    const payload = call?.payload as { price?: unknown; cost?: unknown; fee?: unknown };
    expect(payload.price).toEqual({ amount: 0, currency: "GBP" });
    expect(payload.cost).toEqual({ amount: 20, currency: "EUR" });
    expect(payload.fee).toEqual({ amount: 0, currency: "EUR" });
  });

  test("entity without a tenant-declared money field never calls config:query:values", async () => {
    const plainEntity = {
      defaultCurrency: "EUR",
      fields: { cost: { type: "money" } },
    } as unknown as EntityDefinition;
    const plainScreen: EntityEditScreenDefinition = {
      id: "plain-edit",
      type: "entityEdit",
      entity: "plain",
      layout: { sections: [{ fields: ["cost"] }] },
    };
    const plainSchema: FeatureSchema = {
      featureName: "billing",
      entities: { plain: plainEntity },
      screens: [plainScreen],
    };
    const queriedTypes: string[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string) => {
        queriedTypes.push(type);
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      }) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={plainSchema} qn="billing:screen:plain-edit" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(queriedTypes).not.toContain("config:query:values");
  });
});
