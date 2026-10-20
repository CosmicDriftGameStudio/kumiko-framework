// A min-items rejection of an embedded list shows once at the list, and the
// knock-on issue on a derived head total that is not laid out must not turn the
// result into a banner-only error.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const euro = { kind: "literal", code: "EUR" } as const;

const screenDef: ActionFormScreenDefinition = {
  id: "receive",
  type: "actionForm",
  handler: "demo:write:receive",
  fields: {
    lines: {
      type: "embedded",
      multiple: true,
      minItems: 1,
      schema: { amount: { type: "money", required: true } },
    },
    netTotal: { type: "money", currency: euro },
  },
  derive: { netTotal: { op: "listSum", list: "lines", cell: "amount" } },
  layout: { sections: [{ columns: 1, fields: ["lines"] }] },
};
const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [screenDef] };

function dispatcherRejecting(paths: readonly string[]): Dispatcher {
  return createMockDispatcher({
    write: (async () => ({
      isSuccess: false,
      error: {
        code: "validation_error",
        message: "Validation failed",
        i18nKey: "errors.validation.failed",
        details: {
          fields: paths.map((path) => ({
            path,
            code: "too_small",
            i18nKey: "errors.validation.too_small",
            params: { minimum: 1 },
          })),
        },
      },
    })) as unknown as Dispatcher["write"],
  });
}

async function submit(dispatcher: Dispatcher, addRow: boolean): Promise<void> {
  const { container } = render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "demo:screen:receive" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "#",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen schema={schema} qn="demo:screen:receive" />
      </NavProvider>
    </DispatcherProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("field-lines")).toBeDefined());
  if (addRow) {
    const addButton = container.querySelector('[data-testid$="empty-add"]');
    if (addButton === null) throw new Error("no add-row button");
    fireEvent.click(addButton);
    await waitFor(() => expect(container.querySelector('[data-testid$="empty-add"]')).toBeNull());
  }
  const form = container.querySelector("form");
  if (form === null) throw new Error("no form");
  fireEvent.submit(form);
}

const MIN_MESSAGE = "(minimum: 1)";

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("embedded list min-items rejection", () => {
  test("empty list: the list issue shows once and the unrendered derived total adds no banner", async () => {
    await submit(dispatcherRejecting(["lines", "netTotal"]), false);
    await waitFor(() =>
      expect(screen.getByTestId("field-lines").textContent).toContain(MIN_MESSAGE),
    );
    expect(occurrences(screen.getByTestId("field-lines").textContent ?? "", MIN_MESSAGE)).toBe(1);
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  test("non-empty list: a list-level issue shows once, not in wrapper and list", async () => {
    await submit(dispatcherRejecting(["lines"]), true);
    await waitFor(() =>
      expect(screen.getByTestId("field-lines").textContent).toContain(MIN_MESSAGE),
    );
    expect(occurrences(screen.getByTestId("field-lines").textContent ?? "", MIN_MESSAGE)).toBe(1);
  });
});
