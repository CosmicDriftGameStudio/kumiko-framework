import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { DataTable } = defaultPrimitives;

interface InlinePadding {
  readonly left: string | undefined;
  readonly right: string | undefined;
}

// happy-dom doesn't compute Tailwind layout, so resolve the effective inline
// padding the way Tailwind's cascade does: p-* < px-* < pl-*/pr-*. Variant-
// prefixed utilities (e.g. `[&:has([role=checkbox])]:pr-0`) only apply
// conditionally and are skipped.
function resolveInlinePadding(element: HTMLElement): InlinePadding {
  const tokens = element.className.split(/\s+/).filter((t) => t !== "" && !t.includes(":"));
  const paddingFor = (prefix: string): string | undefined =>
    tokens
      .filter((t) => t.startsWith(`${prefix}-`))
      .at(-1)
      ?.slice(prefix.length + 1);
  const all = paddingFor("p");
  const x = paddingFor("px") ?? all;
  return { left: paddingFor("pl") ?? x, right: paddingFor("pr") ?? x };
}

const columns = [
  { field: "revision", label: "Revision", type: "number", sortable: false },
  { field: "title", label: "Title", type: "string", sortable: true },
] as const;

const rows = [{ id: "r1", values: { revision: 1, title: "First" } }];

describe("DataTable header cells align with body cells", () => {
  test.each([
    ["without sort wiring", undefined],
    ["with sort wiring", mock()],
  ] as const)(
    "%s: every column header has the same inline padding as its cells",
    (_, onSortChange) => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          {...(onSortChange !== undefined && { onSortChange })}
        />,
      );

      for (const col of columns) {
        const header = resolveInlinePadding(screen.getByTestId(`column-${col.field}`));
        const cell = resolveInlinePadding(screen.getByTestId(`cell-r1-${col.field}`));
        expect(header.left).toBeDefined();
        expect(header).toEqual(cell);
      }
    },
  );
});
