// fw#2839: an actionForm has no entity, so `defaultCurrency` never reaches its
// money fields — an untouched one used to submit a bare `0` the handler's zod
// schema rejects (the open half of fw#2763). Each money field now declares its
// own source: a literal code resolves synchronously, `{ kind: "tenant" }` goes
// through the same `config:query:values` query and loading gate as entityEdit.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  SecretMintScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const TENANT_CURRENCY_VALUES = {
  "tenant-settings:config:currency": { value: "GBP", scope: "tenant", source: "tenant-row" },
};

function payScreen(currency: unknown): ActionFormScreenDefinition {
  return {
    id: "invoice-pay",
    type: "actionForm",
    handler: "billing:write:invoice:pay",
    fields: {
      amount: { type: "money", required: true, currency },
      note: { type: "text" },
    },
    layout: { sections: [{ fields: ["amount", "note"] }] },
  } as unknown as ActionFormScreenDefinition;
}

function makeSchema(currency: unknown): FeatureSchema {
  return { featureName: "billing", entities: {}, screens: [payScreen(currency)] };
}

function makeDispatcher(
  writeCalls: { type: string; payload: unknown }[],
  configValues: unknown = TENANT_CURRENCY_VALUES,
): Dispatcher {
  return createMockDispatcher({
    query: (async (type: string) => {
      if (type === "config:query:values") return { isSuccess: true, data: configValues };
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    }) as unknown as Dispatcher["query"],
    write: (async (type: string, payload: unknown) => {
      writeCalls.push({ type, payload });
      return { isSuccess: true, data: { id: "inv-1" } };
    }) as unknown as Dispatcher["write"],
  });
}

async function typeText(testId: string, value: string): Promise<void> {
  const input = screen.getByTestId(testId).querySelector("input");
  if (!input) throw new Error(`expected an <input> inside ${testId}`);
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, value);
}

describe("actionForm money field currency source (fw#2839)", () => {
  test("untouched literal-declared money field submits { amount: 0, currency }, not a bare 0", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher(writeCalls)}>
        <KumikoScreen
          schema={makeSchema({ kind: "literal", code: "CHF" })}
          qn="billing:screen:invoice-pay"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    // `amount` is deliberately left untouched — touching `note` only makes the
    // pristine-form submit button clickable.
    await typeText("field-note", "paid");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const call = writeCalls[0];
    if (call === undefined) throw new Error("expected one write call");
    expect(call.type).toBe("billing:write:invoice:pay");
    expect((call.payload as { amount?: unknown }).amount).toEqual({
      amount: 0,
      currency: "CHF",
    });
  });

  test("tenant-declared field renders nothing until the config query lands, then submits the tenant currency", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher(writeCalls)}>
        <KumikoScreen schema={makeSchema({ kind: "tenant" })} qn="billing:screen:invoice-pay" />
      </DispatcherProvider>,
    );

    // The gate holds the form while the query is in flight — an EUR default
    // would otherwise be visible and, on a fast click, submittable.
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull(), {
      timeout: 3000,
    });

    await typeText("field-note", "paid");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const call = writeCalls[0];
    if (call === undefined) throw new Error("expected one write call");
    expect((call.payload as { amount?: unknown }).amount).toEqual({
      amount: 0,
      currency: "GBP",
    });
  });

  test("a form with only literal-declared money fields never calls config:query:values", async () => {
    const queriedTypes: string[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        queriedTypes.push(type);
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      }) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={makeSchema({ kind: "literal", code: "CHF" })}
          qn="billing:screen:invoice-pay"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(queriedTypes).not.toContain("config:query:values");
  });
});

describe("secretMint money field currency source (fw#2839)", () => {
  const mintScreen = {
    id: "mint-credit",
    type: "secretMint",
    handler: "billing:write:credit:mint",
    fields: {
      amount: { type: "money", required: true, currency: { kind: "literal", code: "CHF" } },
      note: { type: "text" },
    },
    layout: { sections: [{ fields: ["amount", "note"] }] },
    reveal: { fields: [{ field: "token", label: "Token" }] },
    confirm: {
      handler: "billing:write:credit:confirm",
      fields: {
        fee: { type: "money", required: true, currency: { kind: "literal", code: "GBP" } },
        code: { type: "text" },
      },
      layout: { sections: [{ fields: ["fee", "code"] }] },
    },
  } as unknown as SecretMintScreenDefinition;

  test("untouched literal money fields in the mint step and the confirm step both submit { amount: 0, currency }", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { token: "kpat_secret" } };
      }) as unknown as Dispatcher["write"],
    });
    const schema: FeatureSchema = {
      featureName: "billing",
      entities: {},
      screens: [mintScreen],
    };
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="billing:screen:mint-credit" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    await typeText("field-note", "mint it");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const mintCall = writeCalls[0];
    if (mintCall === undefined) throw new Error("expected a mint write call");
    expect(mintCall.type).toBe("billing:write:credit:mint");
    expect((mintCall.payload as { amount?: unknown }).amount).toEqual({
      amount: 0,
      currency: "CHF",
    });

    await waitFor(() => screen.getByTestId("kumiko-screen-secret-mint-reveal"));
    await typeText("field-code", "123456");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(2));
    const confirmCall = writeCalls[1];
    if (confirmCall === undefined) throw new Error("expected a confirm write call");
    expect(confirmCall.type).toBe("billing:write:credit:confirm");
    expect((confirmCall.payload as { fee?: unknown }).fee).toEqual({
      amount: 0,
      currency: "GBP",
    });
  });
});
