import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Columns3 } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableViewOptions } from "../../../data-table-view-types.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { Button as UiButton } from "../../ui/button.tsx";
import { SegmentedControl } from "../segmented-select.tsx";
import { ColumnPickerSection } from "./column-picker-section.tsx";

const POPOVER_CLASS =
  "z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border bg-popover p-3 " +
  "text-popover-foreground shadow-md max-h-[var(--radix-popover-content-available-height)] overflow-y-auto";

const SECTION_TITLE_CLASS = "m-0 text-xs font-medium text-muted-foreground";

/** Renders nothing when the view has neither a column nor a density section. */
export function ViewMenu({
  view,
  columnLabels,
}: {
  readonly view: DataTableViewOptions;
  readonly columnLabels: ReadonlyMap<string, string>;
}): ReactNode {
  const translate = useOptionalTranslation();
  const label = (key: string, fallback: string): string => translate?.(key) ?? fallback;
  const { columns, onColumnsChange, onDensityChange } = view;
  const hasColumns = columns !== undefined && onColumnsChange !== undefined;
  if (!hasColumns && onDensityChange === undefined) return null;

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <UiButton
          type="button"
          variant="outline"
          size="icon"
          className="size-9 max-md:size-11"
          aria-label={label("kumiko.list.view.menu", "View")}
          data-testid="list-view-menu"
        >
          <Columns3 className="size-4" aria-hidden="true" />
        </UiButton>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          className={POPOVER_CLASS}
          data-testid="list-view-menu-content"
        >
          {hasColumns && (
            <section className="flex flex-col gap-1">
              <h3 className={SECTION_TITLE_CLASS}>
                {label("kumiko.list.view.columns", "Columns")}
              </h3>
              <ColumnPickerSection
                columns={columns}
                labels={columnLabels}
                onChange={onColumnsChange}
              />
            </section>
          )}
          {onDensityChange !== undefined && (
            <section className="flex flex-col gap-1">
              <h3 className={SECTION_TITLE_CLASS}>
                {label("kumiko.list.view.density", "Density")}
              </h3>
              <SegmentedControl
                id="list-view-density"
                name="list-view-density"
                value={view.density}
                onChange={(next) => onDensityChange(next === "compact" ? "compact" : "comfortable")}
                options={[
                  {
                    value: "comfortable",
                    label: label("kumiko.list.view.density.comfortable", "Comfortable"),
                  },
                  { value: "compact", label: label("kumiko.list.view.density.compact", "Compact") },
                ]}
                labelProps={{ "aria-label": label("kumiko.list.view.density", "Density") }}
              />
            </section>
          )}
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={view.viewIsDefault}
            onClick={view.onViewReset}
            data-testid="list-view-reset"
          >
            {label("kumiko.list.view.reset", "Reset view")}
          </UiButton>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
