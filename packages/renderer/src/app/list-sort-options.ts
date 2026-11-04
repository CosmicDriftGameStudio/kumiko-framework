import type { ListSortOption } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "../headless/index.ts";
import type { DataTableProps } from "../primitives.tsx";

export function translatedSortOptionProps(
  sortOptions: readonly ListSortOption[] | undefined,
  translate: Translate,
): Pick<DataTableProps, "sortOptions"> {
  if (sortOptions === undefined || sortOptions.length === 0) return {};
  return {
    sortOptions: sortOptions.map((option) => ({
      field: option.field,
      dir: option.dir,
      label: translate(option.label),
    })),
  };
}
