import { describe, expect, test } from "bun:test";
import { TENANT_CURRENCY_CONFIG_KEY } from "@cosmicdrift/kumiko-types/fields";
import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { createMockDispatcher, type MockQueryHandler } from "../../testing.ts";
import { type RangeFilter, useEntityRangeFacets } from "../use-entity-range-facets.ts";

const fields = {
  price: { type: "money" },
  fee: { type: "money", currency: { kind: "tenant" } },
  deposit: { type: "money", currency: { kind: "literal", code: "BHD" } },
};

const screen: EntityListScreenDefinition = {
  id: "orders",
  type: "entityList",
  entity: "order",
  columns: [],
  facets: {
    price: { display: "range" },
    fee: { display: "range" },
    deposit: { display: "range" },
  },
};

const urlFilters = {
  "price.min": ["1000"],
  "fee.min": ["2"],
  "deposit.min": ["3"],
};

function renderRangeFacets(defaultCurrency: string, tenantCurrency: string) {
  const query: MockQueryHandler = async (type) => ({
    isSuccess: true,
    data:
      type === "config:query:values"
        ? { [TENANT_CURRENCY_CONFIG_KEY]: { value: tenantCurrency } }
        : {},
  });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>{children}</DispatcherProvider>
  );
  return renderHook(
    () =>
      useEntityRangeFacets({
        fields,
        screen,
        featureName: "shop",
        defaultCurrency,
        translate: (key) => key,
        urlState: { filters: urlFilters, setFilter: () => {} },
      }),
    { wrapper },
  );
}

const boundOf = (filters: readonly RangeFilter[], field: string): number | undefined =>
  filters.find((filter) => filter.field === field)?.value;

describe("money range facet bounds", () => {
  test("scale by the literal, the tenant and the entity default currency", async () => {
    const hook = renderRangeFacets("JPY", "KWD");
    await waitFor(() => expect(boundOf(hook.result.current.rangeFilters, "fee")).toBe(2000));
    const filters = hook.result.current.rangeFilters;
    expect(boundOf(filters, "price")).toBe(1000);
    expect(boundOf(filters, "deposit")).toBe(3000);
  });

  test("a tenant-currency bound waits for the tenant currency instead of guessing", () => {
    const hook = renderRangeFacets("EUR", "JPY");
    expect(boundOf(hook.result.current.rangeFilters, "fee")).toBeUndefined();
    expect(boundOf(hook.result.current.rangeFilters, "price")).toBe(100000);
  });
});
