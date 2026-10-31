import type { FieldIconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  Building,
  CalendarDays,
  Globe,
  Hash,
  KeyRound,
  Link,
  Lock,
  Mail,
  MapPin,
  Phone,
  Search,
  Tag,
  Undo2,
  User,
  X,
} from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  Fragment,
  type ReactNode,
  useContext,
} from "react";
import { fieldIssueText } from "../../field-issue-text.ts";
import {
  type FieldProps,
  type InputFillAction,
  type TrailingInputAction,
  useTranslation,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Label as UiLabel } from "../ui/label.tsx";
import { StatusBadge } from "../widgets/status-badge.tsx";
import { inFieldIconButtonClass } from "./calendar-popover.tsx";
import type { ComboboxOption } from "./combobox.tsx";
import { groupOptions } from "./option-groups.ts";
import { SegmentedControl } from "./segmented-select.tsx";
import "../react-css-custom-properties.ts";
import { DefaultButton } from "./button.tsx";
import { FieldDescriptionContext, FieldLabelledContext, FieldLayoutContext } from "./contexts.tsx";

// ---- Field (Label + Error) ----

// Matches DefaultBanner's aria-labelledby target: a non-labelable control
// (e.g. Banner's <div>) can't take a real htmlFor, so Field always also
// gives its label a stable id that such controls can point to.
export function fieldLabelId(id: string): string {
  return `${id}-label`;
}

function useFieldLabelProps(
  id: string,
  name: string,
): { "aria-labelledby": string } | { "aria-label": string } {
  const insideLabelledField = useContext(FieldLabelledContext);
  return insideLabelledField ? { "aria-labelledby": fieldLabelId(id) } : { "aria-label": name };
}

function fieldDescriptionId(id: string): string {
  return `${id}-description`;
}

function fieldErrorId(id: string): string {
  return `${id}-error`;
}

export function DefaultField(props: FieldProps): ReactNode {
  const describedBy = [
    props.description !== undefined ? fieldDescriptionId(props.id) : undefined,
    props.issues !== undefined && props.issues.length > 0 ? fieldErrorId(props.id) : undefined,
  ]
    .filter((id) => id !== undefined)
    .join(" ");
  return (
    <FieldLabelledContext.Provider value={props.label !== ""}>
      <FieldDescriptionContext.Provider value={describedBy === "" ? undefined : describedBy}>
        <DefaultFieldBody {...props} />
      </FieldDescriptionContext.Provider>
    </FieldLabelledContext.Provider>
  );
}

function DefaultFieldBody({
  id,
  label,
  required,
  issues,
  labelAppendix,
  fieldAppendix,
  appendixPlacement,
  description,
  status,
  children,
  layout,
  accent,
  hideLabel,
  testId,
  changed,
}: FieldProps): ReactNode {
  const t = useTranslation();
  const hasError = issues !== undefined && issues.length > 0;
  const labelEl = (
    <UiLabel
      id={fieldLabelId(id)}
      htmlFor={id}
      className={cn(
        "min-w-0 gap-0 text-[13px]",
        hasError ? "text-destructive" : "text-foreground",
        hideLabel === true && "sr-only",
      )}
    >
      {/* An inline label sits beside a checkbox and may carry legal text that
          must stay readable in full, so it wraps instead of truncating. */}
      <span
        className={layout === "inline" ? undefined : "truncate"}
        title={typeof label === "string" ? label : undefined}
      >
        {label}
      </span>
      {required === true && (
        <span data-required className="ml-0.5 shrink-0 text-destructive">
          *
        </span>
      )}
    </UiLabel>
  );
  const errorsEl = hasError ? (
    <div
      id={fieldErrorId(id)}
      role="alert"
      data-testid={testId !== undefined ? `${testId}-errors` : undefined}
      className="text-xs text-destructive"
    >
      {issues.map((issue) => (
        <div key={`${issue.path}:${issue.code}`}>{fieldIssueText(t, issue)}</div>
      ))}
    </div>
  ) : null;

  // Inline (boolean/checkbox): Control links, Label rechts — shadcn-Muster.
  if (layout === "inline") {
    return (
      <div data-testid={testId} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <FieldLayoutContext.Provider value="inline">{children}</FieldLayoutContext.Provider>
          {labelEl}
          {labelAppendix !== undefined && labelAppendix}
        </div>
        {errorsEl}
      </div>
    );
  }

  const changedMarker =
    changed === true ? (
      <span
        data-testid={testId !== undefined ? `${testId}-changed` : undefined}
        className="inline-flex items-center gap-1 text-xs text-status-active"
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {t("kumiko.form.changed")}
      </span>
    ) : null;

  const statusEl =
    status !== undefined ? (
      <StatusBadge
        tone={status.tone}
        testId={status.testId ?? (testId !== undefined ? `${testId}-status` : undefined)}
      >
        {status.label}
      </StatusBadge>
    ) : null;
  const belowControl = appendixPlacement === "below-control";

  // Settings row: label/help/origin on the left, control on the right. The
  // hairlines between rows come from the list Grid, not from the row itself.
  if (layout === "row") {
    return (
      <div
        data-testid={testId}
        className={cn(
          "group/row relative grid gap-x-6 gap-y-2 py-4 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:grid-rows-[auto_auto_auto_1fr] @2xl:gap-y-0",
          // Switch rows keep label left / switch right when stacked.
          "@max-2xl:has-[[data-slot=switch]]:grid-cols-[minmax(0,1fr)_auto]",
          accent === true && "@max-2xl:pl-3",
        )}
      >
        {accent === true && (
          <span
            aria-hidden="true"
            data-testid={testId !== undefined ? `${testId}-accent` : undefined}
            className="absolute inset-y-3 w-0.5 bg-status-active @max-2xl:left-0 @2xl:-left-4"
          />
        )}
        <div className="flex min-w-0 items-center gap-2 @2xl:col-start-1 @2xl:row-start-1">
          {labelEl}
          {changedMarker}
          {labelAppendix !== undefined && labelAppendix}
          {statusEl}
        </div>
        {description !== undefined && (
          <div
            id={fieldDescriptionId(id)}
            data-testid={testId !== undefined ? `${testId}-description` : undefined}
            className="min-w-0 text-sm text-muted-foreground @2xl:col-start-1 @2xl:row-start-2 @2xl:mt-1 @max-2xl:group-has-[[data-slot=switch]]/row:col-span-2"
          >
            {description}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1.5 has-[[data-slot=switch]]:items-end @2xl:col-start-2 @2xl:row-span-4 @2xl:row-start-1 @max-2xl:group-has-[[data-slot=switch]]/row:col-start-2 @max-2xl:group-has-[[data-slot=switch]]/row:row-start-1">
          <FieldLayoutContext.Provider value="row">{children}</FieldLayoutContext.Provider>
          {errorsEl}
        </div>
        {fieldAppendix !== undefined && (
          <div className="min-w-0 @2xl:col-start-1 @2xl:row-start-3 @2xl:mt-1 @max-2xl:group-has-[[data-slot=switch]]/row:col-span-2">
            {fieldAppendix}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      {...(belowControl && fieldAppendix !== undefined && { "data-appendix-below": "" })}
      className="flex flex-col gap-1.5"
    >
      {/* A hidden label alone is out of flow; its row would still take the column gap above the control. */}
      {hideLabel === true &&
      changedMarker === null &&
      labelAppendix === undefined &&
      statusEl === null ? (
        labelEl
      ) : (
        <div className="flex items-center justify-between gap-2">
          {changedMarker !== null ? (
            <div className="flex min-w-0 items-center gap-2">
              {labelEl}
              {changedMarker}
            </div>
          ) : (
            labelEl
          )}
          {/* appendix next to the <label>, not inside it: interactive content
            (disclosure button) does not belong in a label element. */}
          {labelAppendix !== undefined && labelAppendix}
          {statusEl}
        </div>
      )}
      {description !== undefined && (
        <div
          id={fieldDescriptionId(id)}
          data-testid={testId !== undefined ? `${testId}-description` : undefined}
          className="text-sm text-muted-foreground"
        >
          {description}
        </div>
      )}
      {/* Default: fieldAppendix above the input, so an expanded detail sits
          right under its trigger in the label row instead of being separated
          from it by the input. below-control keeps the inputs of neighbouring
          fields on one line. */}
      {!belowControl && fieldAppendix !== undefined && fieldAppendix}
      {children}
      {errorsEl}
      {belowControl && fieldAppendix !== undefined && fieldAppendix}
    </div>
  );
}

// ---- Input ----

// Field-icon registry: `EditFieldSpec.icon`/`InputProps.icon` sets a
// symbolic key, mapped here to a lucide component. Unknown keys → no
// icon (clean fallback, no boot-fail). Mirrors NAV_ICONS' pattern
// (nav-tree.tsx) — a separate, smaller registry instead of a shared
// import, because field icons cover a different use case (email, phone,
// location, …) than nav icons (dashboard, tables, …).
const FIELD_ICONS = {
  mail: Mail,
  lock: Lock,
  hash: Hash,
  search: Search,
  user: User,
  phone: Phone,
  calendar: CalendarDays,
  link: Link,
  tag: Tag,
  building: Building,
  globe: Globe,
  key: KeyRound,
  "map-pin": MapPin,
} as const satisfies Readonly<Record<FieldIconKey, typeof Mail>>;

function isFieldIconKey(key: string): key is FieldIconKey {
  return Object.hasOwn(FIELD_ICONS, key);
}

export function fieldIconFor(
  icon: string | undefined,
): (typeof FIELD_ICONS)[FieldIconKey] | undefined {
  return icon !== undefined && isFieldIconKey(icon) ? FIELD_ICONS[icon] : undefined;
}

// Wraps a text/number input with a left-positioned prefix icon when
// `icon` carries a known FIELD_ICONS key. `pl-8` overrides (via
// tailwind-merge) only the left padding of the vendored ui/input.tsx —
// right padding and other defaults stay untouched.
export const FIELD_ICON_CLASS =
  "pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground";

export function withFieldIcon(icon: string | undefined, input: ReactNode): ReactNode {
  const Icon = fieldIconFor(icon);
  if (Icon === undefined) return input;
  return (
    <div className="relative">
      <Icon aria-hidden="true" className={FIELD_ICON_CLASS} />
      {input}
    </div>
  );
}

type InputAddonProps = {
  readonly name: string;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly fill?: InputFillAction | undefined;
};

const INPUT_AFFIX_CLASS =
  "inline-flex shrink-0 items-center text-sm text-muted-foreground max-md:min-h-11";

// Prefix/suffix text and the fill button sit beside the input, not inside it,
// so the input keeps its own padding contract (icon, unit). The wrapper is
// only added when an addon exists — a plain input keeps its tree shape.
export function withInputAddons(addons: InputAddonProps, input: ReactNode): ReactNode {
  const { name, prefix, suffix, fill } = addons;
  if (prefix === undefined && suffix === undefined && fill === undefined) return input;
  return (
    <div data-slot="input-addons" className="flex items-center gap-2">
      {prefix !== undefined && (
        <span data-testid={`input-prefix-${name}`} className={INPUT_AFFIX_CLASS}>
          {prefix}
        </span>
      )}
      <div className="min-w-0 flex-1">{input}</div>
      {suffix !== undefined && (
        <span data-testid={`input-suffix-${name}`} className={INPUT_AFFIX_CLASS}>
          {suffix}
        </span>
      )}
      {fill !== undefined && (
        <DefaultButton
          variant="secondary"
          size="sm"
          onClick={fill.onPress}
          loading={fill.busy === true}
          disabled={fill.disabled === true}
          testId={fill.testId ?? `input-fill-${name}`}
        >
          {fill.label}
        </DefaultButton>
      )}
    </div>
  );
}

// The unit changes the meaning of the value ("58 mi" vs "58 km"), so it is
// exposed as the input's description rather than hidden from assistive tech.
export function unitSuffixId(inputId: string): string {
  return `${inputId}-unit`;
}

const TRAILING_ACTION_ICONS = { clear: X, undo: Undo2 } as const;

// In-field icon button on the right (same look as the date input's calendar
// trigger). The wrapped input must reserve the room itself (`pr-9`).
// `keepWrapper` holds the tree shape when the action comes and goes — a
// write-only input loses its action on the first keystroke, and swapping the
// wrapper would remount the input and drop focus mid-typing.
export function withTrailingAction(
  action: TrailingInputAction | undefined,
  input: ReactNode,
  keepWrapper = false,
): ReactNode {
  if (action === undefined && !keepWrapper) return input;
  const ActionIcon = action !== undefined ? TRAILING_ACTION_ICONS[action.icon] : undefined;
  return (
    <div className="relative">
      {input}
      {action !== undefined && ActionIcon !== undefined && (
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          data-testid={action.testId}
          onClick={action.onPress}
          className={inFieldIconButtonClass}
        >
          <ActionIcon className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// Default presentation for `kind: "select"` without a `display` of its own
// (board rule): up to 3 short options read as a segmented control, up to 3
// longer ones as a vertical radio list, everything else as a dropdown. Labels
// arrive translated, so the widget can differ between UI languages.
const SEGMENTED_SELECT_MAX_OPTIONS = 3;

const SEGMENTED_SELECT_MAX_LABEL_LENGTH = 16;

type SelectPresentation = "segmented" | "radioList" | "dropdown";

export function defaultSelectPresentation(
  options: readonly { readonly label: string }[],
): SelectPresentation {
  if (options.length === 0 || options.length > SEGMENTED_SELECT_MAX_OPTIONS) return "dropdown";
  return options.every((option) => option.label.length <= SEGMENTED_SELECT_MAX_LABEL_LENGTH)
    ? "segmented"
    : "radioList";
}

// A "" value is the unselected placeholder, not a real choice — a radio
// group can't render an unchecked-everything state as its own segment.
// Filtered once so the eligibility count and the rendered segments never drift
// apart.
export function withoutSegmentedSelectPlaceholder<T extends { readonly value: string }>(
  options: readonly T[],
): readonly T[] {
  return options.filter((option) => option.value !== "");
}

export function SegmentedSelect(
  props: Omit<ComponentProps<typeof SegmentedControl>, "labelProps">,
): ReactNode {
  const labelProps = useFieldLabelProps(props.id, props.name);
  return <SegmentedControl {...props} labelProps={labelProps} />;
}

const RADIO_CARD_CLASS =
  "flex items-start gap-3 rounded-lg border border-input bg-background px-[15px] py-[13px] text-sm font-normal text-foreground " +
  "has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:px-[14px] has-[:checked]:py-3 " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:opacity-50";

export function RadioListSelect({
  id,
  name,
  value,
  onChange,
  options,
  variant = "list",
  disabled,
  required,
  hasError,
}: {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly description?: string;
    readonly group?: string;
    readonly disabled?: boolean;
  }[];
  readonly variant?: "list" | "card";
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
}): ReactNode {
  const labelProps = useFieldLabelProps(id, name);
  const card = variant === "card";
  // One radiogroup over all sections keeps native arrow-key navigation across groups
  // (radios share `name` in DOM order).
  const descriptionIdOf = (opt: { readonly value: string }): string =>
    `${id}-option-${options.findIndex((o) => o.value === opt.value)}-description`;
  return (
    <div
      role="radiogroup"
      {...labelProps}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      data-testid={`radio-list-${id}`}
      data-radio-list=""
      className="flex flex-col gap-2"
    >
      {groupOptions(options).map((section) => (
        <Fragment key={section.heading ?? ""}>
          {section.heading !== undefined && (
            <div
              data-testid={`radio-list-${id}-group-${section.heading}`}
              className="mt-1 text-xs font-medium text-muted-foreground"
            >
              {section.heading}
            </div>
          )}
          {section.options.map((opt) => (
            <label
              key={opt.value}
              className={
                card
                  ? RADIO_CARD_CLASS
                  : "flex items-start gap-2 text-sm font-normal text-foreground has-[:disabled]:opacity-50"
              }
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={opt.value === value}
                disabled={disabled === true || opt.disabled === true}
                aria-describedby={opt.description !== undefined ? descriptionIdOf(opt) : undefined}
                data-testid={`radio-list-${id}-${opt.value}`}
                onChange={() => onChange(opt.value)}
                className={cn("size-4 accent-primary", card ? "mt-0.5 shrink-0" : "mt-0.5")}
              />
              <span className="flex flex-col gap-0.5">
                <span className={cn(card && "font-semibold")}>{opt.label}</span>
                {opt.description !== undefined && (
                  <span id={descriptionIdOf(opt)} className="text-[13px] text-foreground-secondary">
                    {opt.description}
                  </span>
                )}
              </span>
            </label>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

// The vendored shadcn Textarea carries `field-sizing: content`, which derives
// the box height from the content and makes the `rows` attribute inert.
// A declared row count therefore only survives as a min-height floor: the field
// starts at `rows` lines tall and still grows with its content. The addend is
// the textarea frame — py-2 top+bottom plus the 1px borders.
export function textareaMinHeight(rows: number): CSSProperties {
  return { minHeight: `calc(${rows} * 1lh + 1rem + 2px)` };
}

export function withInlineDisabledHint(option: ComboboxOption): ComboboxOption {
  if (option.disabled !== true || option.description === undefined) return option;
  return {
    value: option.value,
    label: `${option.label} (${option.description})`,
    disabled: true,
    ...(option.group !== undefined && { group: option.group }),
  };
}
