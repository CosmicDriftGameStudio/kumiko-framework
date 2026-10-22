import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { createStaticLocaleResolver, LocaleProvider } from "../../../index.ts";
import { RowActionsCell } from "../row-actions.tsx";

const row = { id: "r1", values: {} };
const actions = [
  { id: "edit", label: "Edit", onTrigger: () => {} },
  { id: "archive", label: "Archive", onTrigger: () => {} },
  { id: "delete", label: "Delete", onTrigger: () => {} },
];

describe("RowActionsCell keeps its actions on one line", () => {
  for (const mode of ["adaptive", "inline"] as const) {
    test(`${mode} mode never wraps`, () => {
      const { container } = render(
        <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[]}>
          <RowActionsCell row={row} actions={actions} mode={mode} />
        </LocaleProvider>,
      );
      const wrapper = container.firstElementChild;

      expect(wrapper?.className).toContain("flex-nowrap");
      expect(wrapper?.className).toContain("whitespace-nowrap");
      expect(wrapper?.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
    });
  }
});
