import { Columns3 } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import type { DataTableViewOptions } from "../../../data-table-view-types.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { Button as UiButton } from "../../ui/button.tsx";
import { SegmentedControl } from "../segmented-select.tsx";
import { ColumnPickerSection } from "./column-picker-section.tsx";
import { PinSection } from "./pin-section.tsx";

const POPOVER_CLASS =
  "z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border bg-popover p-3 " +
  "text-popover-foreground shadow-md max-h-[var(--radix-popover-content-available-height)] overflow-y-auto";

const SECTION_TITLE_CLASS = "m-0 text-xs font-medium text-muted-foreground";

/** The menu also opens for pinning or resizing alone: pins get a section, widths only the reset. */
export function viewHasMenu(view: DataTableViewOptions | undefined): view is DataTableViewOptions {
  if (view === undefined) return false;
  return (
    (view.columns !== undefined && view.onColumnsChange !== undefined) ||
    view.onDensityChange !== undefined ||
    view.groupBy !== undefined ||
    (view.pins !== undefined && view.onPinsChange !== undefined) ||
    (view.widths !== undefined && view.onWidthChange !== undefined)
  );
}

export function ViewMenu({
  view,
  columnLabels,
}: {
  readonly view: DataTableViewOptions;
  readonly columnLabels: ReadonlyMap<string, string>;
}): ReactNode {
  const translate = useOptionalTranslation();
  const label = (key: string, fallback: string): string => translate?.(key) ?? fallback;
  const { columns, onColumnsChange, onDensityChange, pins, onPinsChange } = view;
  const hasColumns = columns !== undefined && onColumnsChange !== undefined;
  if (!viewHasMenu(view)) return null;
  const pinnableFields =
    columns !== undefined
      ? columns.filter((column) => column.visible).map((column) => column.field)
      : [...columnLabels.keys()];

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
          {view.groupBy !== undefined && (
            <section className="flex flex-col gap-1">
              <h3 className={SECTION_TITLE_CLASS}>{label("kumiko.list.group.by", "Group by")}</h3>
              <SegmentedControl
                id="list-view-group-by"
                name="list-view-group-by"
                value={view.groupBy.value}
                onChange={view.groupBy.onChange}
                options={[
                  { value: "", label: label("kumiko.list.group.none", "None") },
                  ...view.groupBy.fields.map((field) => ({
                    value: field,
                    label: columnLabels.get(field) ?? field,
                  })),
                ]}
                labelProps={{ "aria-label": label("kumiko.list.group.by", "Group by") }}
              />
            </section>
          )}
          {pins !== undefined && onPinsChange !== undefined && (
            <section className="flex flex-col gap-1">
              <h3 className={SECTION_TITLE_CLASS}>
                {label("kumiko.list.view.pinning", "Pinned columns")}
              </h3>
              <PinSection
                fields={pinnableFields}
                labels={columnLabels}
                pins={pins}
                onChange={onPinsChange}
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
