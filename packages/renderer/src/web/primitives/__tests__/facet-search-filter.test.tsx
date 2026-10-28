import { describe, expect, test } from "bun:test";
import { REFERENCE_SEARCH_DEBOUNCE_MS } from "../../../index.ts";
import { act, fireEvent, render, screen, waitFor } from "../../__tests__/test-utils.tsx";
import { FacetFilter } from "../facet-filter.tsx";

const options = [
  { value: "t1", label: "Acme" },
  { value: "t2", label: "Globex" },
];

describe("FacetFilter with a server-side search", () => {
  test("typing reports the term after the debounce, and picking an option toggles it", async () => {
    const searches: string[] = [];
    const changes: Array<readonly string[]> = [];
    render(
      <FacetFilter
        facet={{
          field: "tenantId",
          label: "Tenant",
          options,
          onSearchChange: (query) => searches.push(query),
        }}
        selected={[]}
        onChange={(_field, values) => changes.push(values)}
      />,
    );
    fireEvent.click(screen.getByTestId("facet-tenantId"));
    const input = await screen.findByTestId("facet-tenantId-search");

    fireEvent.change(input, { target: { value: "Glo" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, REFERENCE_SEARCH_DEBOUNCE_MS + 50));
    });
    expect(searches).toContain("Glo");
    expect(searches.filter((query) => query === "Glo")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("facet-tenantId-t2"));
    await waitFor(() => expect(changes).toEqual([["t2"]]));
  });
});
