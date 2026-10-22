import { PanelLeft, PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableColumnPin, DataTableColumnPins } from "../../../data-table-view-types.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { Button as UiButton } from "../../ui/button.tsx";

function togglePin(
  pins: DataTableColumnPins,
  field: string,
  side: DataTableColumnPin,
): DataTableColumnPins {
  const { [field]: current, ...others } = pins;
  return current === side ? others : { ...others, [field]: side };
}

function PinButton({
  field,
  label,
  side,
  pinned,
  onClick,
}: {
  readonly field: string;
  readonly label: string;
  readonly side: DataTableColumnPin;
  readonly pinned: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const translate = useOptionalTranslation();
  const Icon = side === "left" ? PanelLeft : PanelRight;
  const ariaLabel =
    translate?.(`kumiko.list.view.pin-${side}`, { column: label }) ?? `Pin ${label} ${side}`;
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
      aria-label={ariaLabel}
      aria-pressed={pinned}
      data-testid={`list-view-pin-${field}-${side}`}
      onClick={onClick}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </UiButton>
  );
}

export function PinSection({
  fields,
  labels,
  pins,
  onChange,
}: {
  readonly fields: readonly string[];
  readonly labels: ReadonlyMap<string, string>;
  readonly pins: DataTableColumnPins;
  readonly onChange: (next: DataTableColumnPins) => void;
}): ReactNode {
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="list-view-pins">
      {fields.map((field) => {
        const label = labels.get(field) ?? field;
        return (
          <li key={field} className="flex h-8 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
            {(["left", "right"] as const).map((side) => (
              <PinButton
                key={side}
                field={field}
                label={label}
                side={side}
                pinned={pins[field] === side}
                onClick={() => onChange(togglePin(pins, field, side))}
              />
            ))}
          </li>
        );
      })}
    </ul>
  );
}
