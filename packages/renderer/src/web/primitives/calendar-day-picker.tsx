// The react-day-picker chunk: loaded by CalendarPopover on first open.

import type { ReactElement, ReactNode } from "react";
import { DayPicker, type DropdownProps } from "react-day-picker";
import { cn } from "../lib/cn.ts";

export type CalendarDayPickerProps = {
  readonly selected: Date | undefined;
  readonly onSelect: (d: Date | undefined) => void;
  readonly startMonth: Date;
  readonly endMonth: Date;
  readonly disabledMatchers: readonly ({ before: Date } | { after: Date })[];
};

const dropdownSelectClass =
  "rounded-sm border border-input bg-transparent px-1.5 py-0.5 text-sm font-medium " +
  "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// rdp v9's default dropdown renders an aria-hidden <span> with the same label
// next to the <select>, hidden only by rdp's own style.css. Our token classes
// replace that CSS, so the label showed twice; a bare <select> avoids it
// regardless of CSS.
function SelectDropdown({ options, className, ...selectProps }: DropdownProps): ReactElement {
  return (
    <select className={cn(dropdownSelectClass, className)} {...selectProps}>
      {options?.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// Month/year selects come from SelectDropdown (components prop), so only the dropdowns container is styled here.
const dayPickerClasses = {
  root: "rdp-root",
  months: "flex flex-col gap-2",
  month: "flex flex-col gap-2",
  month_caption: "flex justify-center items-center h-7 text-sm font-medium",
  dropdowns: "flex items-center gap-1 text-sm font-medium",
  nav: "flex items-center gap-1 absolute right-1 top-2",
  button_previous: "inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-accent",
  button_next: "inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-accent",
  weekdays: "flex",
  weekday: "w-8 text-xs font-normal text-muted-foreground",
  week: "flex mt-1",
  day: "w-8 h-8 p-0 text-sm",
  day_button:
    "inline-flex h-8 w-8 items-center justify-center rounded-sm hover:bg-accent " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  selected:
    "[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:hover:bg-primary/90",
  today: "[&_button]:underline",
  outside: "text-muted-foreground/50",
  disabled: "text-muted-foreground/30 pointer-events-none",
};

export default function CalendarDayPicker({
  selected,
  onSelect,
  startMonth,
  endMonth,
  disabledMatchers,
}: CalendarDayPickerProps): ReactNode {
  return (
    <DayPicker
      mode="single"
      captionLayout="dropdown"
      startMonth={startMonth}
      endMonth={endMonth}
      selected={selected}
      // Without defaultMonth DayPicker opens on today, not on the chosen date.
      defaultMonth={selected}
      {...(disabledMatchers.length > 0 && { disabled: [...disabledMatchers] })}
      onSelect={(d) => onSelect(d)}
      classNames={dayPickerClasses}
      components={{ Dropdown: SelectDropdown }}
    />
  );
}
