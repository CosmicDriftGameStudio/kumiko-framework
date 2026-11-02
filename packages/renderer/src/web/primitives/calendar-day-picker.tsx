// The react-day-picker chunk: loaded by CalendarPopover on first open.

import type { ReactElement, ReactNode } from "react";
import { DayPicker, type DropdownProps } from "react-day-picker";
import { de } from "react-day-picker/locale/de";
import { enUS } from "react-day-picker/locale/en-US";
import { es } from "react-day-picker/locale/es";
import { fr } from "react-day-picker/locale/fr";
import { it } from "react-day-picker/locale/it";
import { useLocale } from "../../index.ts";
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

const dayPickerLocales: Readonly<Record<string, typeof enUS>> = { de, es, fr, it, en: enUS };

// The rdp locale carries month/weekday names and the week start (de → Monday).
function dayPickerLocaleFor(appLocale: string): typeof enUS {
  const language = appLocale.split("-")[0]?.toLowerCase() ?? "";
  return dayPickerLocales[language] ?? enUS;
}

const navButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground " +
  "hover:bg-accent hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// navLayout="around" renders prev/next as siblings of the caption inside
// `month`; the 3-column grid keeps them beside the dropdowns instead of on top.
// Month/year selects come from SelectDropdown (components prop), so only the dropdowns container is styled here.
const dayPickerClasses = {
  root: "rdp-root",
  months: "flex flex-col gap-2",
  month: "grid grid-cols-[auto_1fr_auto] items-center gap-x-1 gap-y-2",
  month_caption: "flex justify-center items-center h-7 text-sm font-medium",
  month_grid: "col-span-3",
  dropdowns: "flex items-center gap-1 text-sm font-medium",
  chevron: "h-4 w-4 fill-current",
  button_previous: navButtonClass,
  button_next: navButtonClass,
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
  const appLocale = useLocale().locale();
  return (
    <DayPicker
      mode="single"
      captionLayout="dropdown"
      navLayout="around"
      locale={dayPickerLocaleFor(appLocale)}
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
