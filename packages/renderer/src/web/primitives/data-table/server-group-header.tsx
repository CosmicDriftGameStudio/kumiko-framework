import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import type { DataTableServerGroup } from "../../../data-table-aggregate-types.ts";
import type { ListColumnViewModel } from "../../../headless/index.ts";
import { useOptionalLocale, useOptionalTranslation } from "../../../index.ts";
import { DataTableCell } from "../data-table-cell.tsx";
import { MeasureValue, measureLabel } from "./measure-value.tsx";

const NO_ROW: Readonly<Record<string, unknown>> = {};

// Reports the header once it scrolls near the viewport; without an observer
// (tests, old engines) every header counts as visible right away.
function useReportWhenVisible(onVisible: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisibleRef.current();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        onVisibleRef.current();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function GroupValueLabel({
  group,
  column,
}: {
  readonly group: DataTableServerGroup;
  readonly column: ListColumnViewModel | undefined;
}): ReactNode {
  const translate = useOptionalTranslation();
  const locale = useOptionalLocale();
  if (group.label !== undefined) return group.label;
  if (group.value === null || group.value === "") {
    return translate?.("kumiko.list.group.empty") ?? "(empty)";
  }
  return (
    <DataTableCell
      value={group.value}
      row={NO_ROW}
      field={column?.field ?? ""}
      type={column?.type ?? "text"}
      translate={translate}
      locale={locale}
      {...(column?.optionLabels !== undefined && { optionLabels: column.optionLabels })}
      {...(column?.optionTones !== undefined && { optionTones: column.optionTones })}
    />
  );
}

/** Header of a server group: toggle, value, server row count and the group's measures. */
export function ServerGroupHeader({
  group,
  groupColumn,
  columnOf,
  onToggle,
  onVisible,
}: {
  readonly group: DataTableServerGroup;
  readonly groupColumn: ListColumnViewModel | undefined;
  readonly columnOf: (field: string) => ListColumnViewModel | undefined;
  readonly onToggle: (key: string) => void;
  readonly onVisible: (key: string) => void;
}): ReactNode {
  const translate = useOptionalTranslation();
  const reportRef = useReportWhenVisible(() => onVisible(group.key));
  return (
    <div
      ref={reportRef}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 pe-4 text-xs text-foreground-secondary"
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        data-testid={`row-group-${group.key}-toggle`}
        onClick={() => onToggle(group.key)}
        className="flex items-center gap-2 py-2 ps-4 text-left font-medium"
      >
        {group.collapsed ? (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        )}
        <GroupValueLabel group={group} column={groupColumn} />
        <span
          data-testid={`row-group-${group.key}-count`}
          className="rounded-full bg-muted px-2 py-0.5 tabular-nums text-muted-foreground"
        >
          {group.count.toLocaleString()}
        </span>
      </button>
      {group.measures.map((measure) => {
        const column = columnOf(measure.field);
        return (
          <span
            key={`${measure.kind}-${measure.field}`}
            data-testid={`row-group-${group.key}-${measure.kind}-${measure.field}`}
            className="inline-flex items-center gap-1.5 tabular-nums"
          >
            <span className="text-muted-foreground">
              {measureLabel(measure, column, translate)}
            </span>
            <MeasureValue measure={measure} column={column} />
          </span>
        );
      })}
    </div>
  );
}
