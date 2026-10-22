import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

/** Keys of the row groups whose default open/closed state the user flipped. */
export function useToggledRowGroups(): readonly [ReadonlySet<string>, (key: string) => void] {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return [toggled, toggle];
}

export function RowGroupToggle({
  groupKey,
  collapsed,
  label,
  onToggle,
}: {
  readonly groupKey: string;
  readonly collapsed: boolean;
  readonly label: ReactNode;
  readonly onToggle: (groupKey: string) => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      data-testid={`row-group-${groupKey}-toggle`}
      onClick={() => onToggle(groupKey)}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-foreground-secondary"
    >
      {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      {label}
    </button>
  );
}
