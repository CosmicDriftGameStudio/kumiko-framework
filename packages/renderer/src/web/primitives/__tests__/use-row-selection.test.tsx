import { describe, expect, test } from "bun:test";
import type { ListRowViewModel } from "../../../headless/index.ts";
import { act, renderHook } from "../../__tests__/test-utils.tsx";
import { useRowSelection } from "../data-table/use-row-selection.ts";

function rowsOf(...ids: string[]): readonly ListRowViewModel[] {
  return ids.map((id) => ({ id, values: {} }) as unknown as ListRowViewModel);
}

describe("useRowSelection", () => {
  test("an empty result drops the selection, so a re-widened list starts unselected", () => {
    const { result, rerender } = renderHook(({ rows }) => useRowSelection(rows), {
      initialProps: { rows: rowsOf("a", "b") },
    });
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    expect(result.current.selectedRows).toHaveLength(2);

    rerender({ rows: rowsOf() });
    rerender({ rows: rowsOf("a", "b") });

    expect(result.current.selectedRows).toHaveLength(0);
    expect(result.current.isSelected("a")).toBe(false);
  });

  test("rows kept by retainOnly survive the empty gap of the following reload", () => {
    const { result, rerender } = renderHook(({ rows }) => useRowSelection(rows), {
      initialProps: { rows: rowsOf("a", "b") },
    });
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    act(() => result.current.retainOnly(new Set(["b"])));

    rerender({ rows: rowsOf() });
    rerender({ rows: rowsOf("b", "c") });

    expect(result.current.selectedRows.map((row) => row.id)).toEqual(["b"]);
  });
});
