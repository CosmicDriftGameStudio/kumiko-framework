// actionForm `derive`: net/VAT/gross follow the line items live, are
// read-only while derived, and become inputs once the list is empty.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { act, render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type CorePrimitives,
  type EmbeddedListInputProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import { NavProvider } from "../nav.tsx";

const capturedInputs: Record<string, InputProps | undefined> = {};
const captureInput: ComponentType<InputProps> = (props) => {
  capturedInputs[props.name] = props;
  return null;
};
let capturedList: EmbeddedListInputProps | undefined;
const captureList: ComponentType<EmbeddedListInputProps> = (props) => {
  capturedList = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: captureInput,
  EmbeddedListInput: captureList,
  DataTable: noop,
  Form: passChildren,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

const euro = { kind: "literal", code: "EUR" } as const;

const screen: ActionFormScreenDefinition = {
  id: "receive",
  type: "actionForm",
  handler: "shop:write:receive",
  fields: {
    lines: {
      type: "embedded",
      multiple: true,
      schema: {
        amount: { type: "money", required: true },
        vatRate: { type: "decimal", scale: 2, required: true },
        vatAmount: { type: "money" },
      },
      derived: { vatAmount: { op: "percent", from: ["amount", "vatRate"] } },
    },
    netTotal: { type: "money", currency: euro },
    vatRate: { type: "decimal", precision: 5, scale: 2 },
    vatTotal: { type: "money", currency: euro },
    grossTotal: { type: "money", currency: euro },
  },
  derive: {
    netTotal: { op: "listSum", list: "lines", cell: "amount" },
    vatTotal: {
      op: "listSum",
      list: "lines",
      cell: "vatAmount",
      whenEmpty: { op: "percent", from: ["netTotal", "vatRate"] },
    },
    grossTotal: { op: "sum", from: ["netTotal", "vatTotal"] },
  },
  layout: {
    sections: [{ columns: 1, fields: ["lines", "netTotal", "vatRate", "vatTotal", "grossTotal"] }],
  },
};

const dispatcher = {
  write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
  query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
  batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
  statusStore: {
    getState: () => "online",
    subscribe: () => () => {},
  } as unknown as Dispatcher["statusStore"],
  async *stream() {},
  pendingWrites: () => [],
  pendingFiles: () => [],
} satisfies Dispatcher;

function mountForm(): void {
  for (const key of Object.keys(capturedInputs)) delete capturedInputs[key];
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider
          value={{
            route: { screenId: "shop:receive" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen
              schema={{ featureName: "shop", entities: {}, screens: [screen] } as FeatureSchema}
              qn="shop:screen:receive"
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function moneyValue(name: string): number | "" | undefined {
  const input = capturedInputs[name];
  return input?.kind === "money" ? input.value : undefined;
}

function isLocked(name: string): boolean {
  const input = capturedInputs[name];
  if (input === undefined) throw new Error(`no input captured for ${name}`);
  return "disabled" in input && input.disabled === true;
}

function list(): EmbeddedListInputProps {
  if (capturedList === undefined) throw new Error("no embedded list captured");
  return capturedList;
}

describe("actionForm derive in the renderer", () => {
  test("typing line amounts updates net, VAT and gross live and locks the totals", async () => {
    mountForm();
    await waitFor(() => {
      expect(capturedList).toBeDefined();
    });
    act(() => list().onAddRow());
    act(() => list().onCellChange(0, "amount", 1005));
    act(() => list().onCellChange(0, "vatRate", 19));
    act(() => list().onAddRow());
    act(() => list().onCellChange(1, "amount", 2000));
    act(() => list().onCellChange(1, "vatRate", 7));

    // 19% of 10.05 = 1.91 (rounded), 7% of 20.00 = 1.40
    await waitFor(() => {
      expect(moneyValue("netTotal")).toBe(3005);
      expect(moneyValue("vatTotal")).toBe(331);
      expect(moneyValue("grossTotal")).toBe(3336);
    });
    expect(isLocked("netTotal")).toBe(true);
    expect(isLocked("vatTotal")).toBe(true);
    expect(isLocked("grossTotal")).toBe(true);
    expect(isLocked("vatRate")).toBe(true);
  });

  test("with every line removed the net is typed, VAT follows the rate and gross follows both", async () => {
    mountForm();
    await waitFor(() => {
      expect(capturedList).toBeDefined();
    });
    act(() => list().onAddRow());
    act(() => list().onCellChange(0, "amount", 1000));
    act(() => list().onCellChange(0, "vatRate", 19));
    await waitFor(() => {
      expect(moneyValue("netTotal")).toBe(1000);
    });
    act(() => list().onRemoveRow(0));

    await waitFor(() => {
      expect(isLocked("netTotal")).toBe(false);
    });
    expect(isLocked("vatRate")).toBe(false);
    expect(isLocked("grossTotal")).toBe(true);

    const net = capturedInputs["netTotal"];
    if (net?.kind !== "money") throw new Error("expected a money input for netTotal");
    act(() => net.onChange(20000));
    const rate = capturedInputs["vatRate"];
    if (rate?.kind !== "number") throw new Error("expected a number input for vatRate");
    act(() => rate.onChange(10));

    await waitFor(() => {
      expect(moneyValue("netTotal")).toBe(20000);
      expect(moneyValue("vatTotal")).toBe(2000);
      expect(moneyValue("grossTotal")).toBe(22000);
    });
  });
});
