// shadcn+Tailwind Default-Primitives für den Web-Renderer.
// Konsumieren den Primitives-Contract aus `@cosmicdrift/kumiko-renderer`. Keine
// useTokens()-Aufrufe — die Farben kommen aus den Tailwind-Klassen
// die auf die shadcn-CSS-Variablen referenzieren.
//
// Muster: pro Primitive eine Tailwind-Klassen-Komposition,
// Konfigurierbarkeit über `class-variance-authority` für variant-
// basierte Stile. Radix-UI-Unterbau für interaktive Elemente (Modal,
// Dropdown etc. kommen später).

import type {
  FieldIconKey,
  IconKey,
  SelectOptionTone,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListRowViewModel } from "@cosmicdrift/kumiko-headless";
import { applyFormatSpec, isSafeHref } from "@cosmicdrift/kumiko-headless";
import type {
  DataTableRowAction,
  DataTableRowActionMode,
  DataTableSort,
  DataTableSortDir,
} from "@cosmicdrift/kumiko-renderer";
import {
  type ActionMenuItemSpec,
  type ActionOverflowMenuProps,
  type BannerProps,
  type ButtonProps,
  type CardProps,
  type CorePrimitives,
  type DataTableDateRangeFacet,
  type DataTableFacet,
  type DataTableProps,
  type DataTableRowGrouping,
  type FieldCellWidth,
  type FieldProps,
  type FillContainerProps,
  type FormProps,
  type FormSectionNavItem,
  type FormWidth,
  type GridCellProps,
  type GridProps,
  type HeadingProps,
  type InputProps,
  InsideDrawerProvider,
  type LinkProps,
  type ProgressProps,
  type SecretRevealProps,
  type SectionProps,
  STICKY_PRIMARY_ACTION_PROP,
  type StepBarProps,
  type StickyPrimaryActionMarker,
  shouldRenderActionsIconOnly,
  statusToneForOptionTone,
  statusToneForValue,
  type TextProps,
  useColumnRenderer,
  useInsideDrawer,
  useOptionalLocale,
  useOptionalTranslation,
  useTranslation,
  type WizardStepGroupProps,
  WriteFailedError,
} from "@cosmicdrift/kumiko-renderer";
import { cva } from "class-variance-authority";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Hash,
  KeyRound,
  Link,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Search,
  SlidersHorizontal,
  Tag,
  User,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  type ChangeEvent,
  Children,
  type CSSProperties,
  createContext,
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type TableHTMLAttributes,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Icon, NAV_ICONS } from "../icons.js";
import { cn } from "../lib/cn.js";
import { Badge } from "../ui/badge.js";
import { buttonVariants, Button as UiButton } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input as UiInput } from "../ui/input.js";
import { Label as UiLabel } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { Textarea } from "../ui/textarea.js";
import { ProgressBar } from "../widgets/progress-bar.js";
import { StatusBadge } from "../widgets/status-badge.js";
import { StepBar } from "../widgets/step-bar.js";
import { ComboboxInput } from "./combobox.js";
import { DateInput } from "./date-input.js";
import { DefaultDialog } from "./dialog.js";
import { DefaultDrawer } from "./drawer.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { EmbeddedListInput } from "./embedded-list-input.js";
import { FileUploadInput } from "./file-upload.js";
import { DefaultJsonView } from "./json-view.js";
import { screenPaddingClassName, screenWidthClassName } from "./layout.js";
import { DefaultLightbox } from "./lightbox.js";
import { LocatedTimestampInput } from "./located-timestamp-input.js";
import { DefaultMetric, DefaultMetricBand } from "./metric.js";
import { DefaultModal } from "./modal.js";
import { currencyDecimals, formatMoney, MoneyInput } from "./money-input.js";
import { NumberInput } from "./number-input.js";
import { DefaultPageHeader } from "./page-header.js";
import { PromoPanel } from "./promo-panel.js";
import { CopyButton, ShareButton } from "./share-actions.js";
import { DefaultStatusBadge } from "./status-badge.js";
import {
  STICKY_FOOTER_SAFE_AREA_CLASS,
  STICKY_FOOTER_SPACER_CLASS,
  StickyActionBar,
} from "./sticky-action-bar.js";
import { DefaultTabs } from "./tabs.js";
import { TimestampInput } from "./timestamp-input.js";
import { useToast } from "./toast.js";
import { TzInput } from "./tz-input.js";
import { useIsNarrowViewport } from "./use-narrow-viewport.js";

// ---- Card-Chrome (eine Definition für Form/Section/Card) ----

// Die eine Card-Surface. Maße (Padding/Radius/Shadow) kommen aus --card-*
// CSS-Tokens (Defaults in styles.css), damit eine App sie einmal zentral in
// ihrer styles.css überschreiben kann — wie die Farben. Radius-Variante:
// xl = Card/Screen-Fläche (Default, token-getrieben), lg = "innen"-Fläche.
const cardSurface = cva(
  "flex flex-col border bg-card text-card-foreground shadow-[var(--card-shadow)]",
  {
    variants: { radius: { xl: "rounded-[var(--card-radius)]", lg: "rounded-lg" } },
    defaultVariants: { radius: "xl" },
  },
);
// Wraps instead of running off-screen when the row outgrows its container (fw#2528).
const cardFooter = "flex flex-wrap items-center justify-end gap-2 px-[var(--card-padding)] py-4";
// /30 read as nearly invisible against the light-theme card (white card,
// muted at 94% lightness) — /50 keeps the same token, just a stronger step.
const cardFooterBorder = "border-t bg-muted/50";
const cardHeaderBorder = "border-b bg-muted/50";

// ---- Button (vendored shadcn ui/button) ----

// Contract-Variant → shadcn-Variant: secondary war schon immer der
// bordered-bg-background-Look = shadcns `outline`. primary→default,
// danger→destructive, link→link (kein BG, underline on hover).
const BUTTON_VARIANT = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  link: "link",
  "danger-ghost": "ghost",
  ghost: "ghost",
} as const;

const BUTTON_SIZE = {
  sm: "sm",
  md: "default",
  icon: "icon",
} as const;

// Closed IconKey vocabulary, checked against the shared NAV_ICONS registry
// (icons.tsx) — an unknown key (schema data isn't statically typed against
// IconKey the way this prop is) renders no icon instead of crashing, same
// fallback shape as fieldIconFor above.
function actionIconFor(icon: IconKey | undefined): IconKey | undefined {
  return icon !== undefined && Object.hasOwn(NAV_ICONS, icon) ? icon : undefined;
}

function DefaultButton({
  type = "button",
  onClick,
  disabled,
  loading,
  variant = "primary",
  size = "md",
  ariaLabel,
  title,
  pressed,
  expanded,
  width = "auto",
  children,
  testId,
  className,
  ref,
  icon,
  iconEnd,
  dataAttributes,
}: ButtonProps): ReactNode {
  // link-Variant rendert text-artig (Inline-Link im Fließtext/Banner), nicht als
  // gepolsterte Fläche; width="full" streckt CTA-Buttons in Karten/Panels.
  const resolvedClassName = cn(
    variant === "link" ? "h-auto px-0 py-0" : "",
    variant === "danger-ghost"
      ? "text-destructive hover:text-destructive hover:bg-destructive/10"
      : "",
    variant === "ghost" ? "text-primary hover:text-primary hover:bg-primary/10" : "",
    variant === "secondary" ? "border-input hover:bg-muted" : "",
    pressed === true
      ? "border-primary/40 bg-accent text-accent-foreground ring-1 ring-primary/30"
      : "",
    width === "full" ? "w-full" : "",
    className,
  );
  const IconStart = icon !== undefined ? NAV_ICONS[icon] : undefined;
  const IconEnd = iconEnd !== undefined ? NAV_ICONS[iconEnd] : undefined;
  // Loading swaps the leading icon slot for a spinner and keeps `children` —
  // replacing the label would shift the button's width mid-submit.
  const leading =
    loading === true ? (
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
    ) : IconStart !== undefined ? (
      <IconStart className="size-4" aria-hidden="true" />
    ) : null;
  return (
    <UiButton
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled === true || loading === true}
      {...dataAttributes}
      data-testid={testId}
      data-loading={loading === true ? "true" : undefined}
      variant={BUTTON_VARIANT[variant]}
      size={BUTTON_SIZE[size]}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={title ?? (size === "icon" ? ariaLabel : undefined)}
      className={resolvedClassName}
    >
      {leading}
      {children}
      {IconEnd !== undefined && <IconEnd className="size-4" aria-hidden="true" />}
    </UiButton>
  );
}

// ---- Banner (shadcn: Alert) ----

function DefaultBanner({
  variant = "info",
  children,
  actions,
  padded,
  testId,
  id,
}: BannerProps): ReactNode {
  const isError = variant === "error";
  const isWarning = variant === "warning";
  // `id` is set when a <Field> wraps this Banner as its control (see
  // BannerProps.id). A <div> isn't labelable, so a <label htmlFor> pointing
  // at it is inert for screen readers — role="group" + aria-labelledby is
  // the actual mechanism, pointed at the label id Field emits (fieldLabelId).
  const bannerRole = id !== undefined ? "group" : isError ? "alert" : undefined;
  const banner = (
    <div
      role={bannerRole}
      {...(id !== undefined && { "aria-labelledby": fieldLabelId(id) })}
      data-testid={testId}
      data-variant={variant}
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm flex items-center gap-3",
        isError
          ? "border-destructive/50 text-destructive bg-destructive/10 dark:border-destructive"
          : isWarning
            ? "border-status-warn/30 bg-status-warn/10 text-status-warn"
            : "bg-card text-card-foreground",
      )}
    >
      <div className="flex-1">{children}</div>
      {actions !== undefined && <div data-slot="actions">{actions}</div>}
    </div>
  );
  // Page-State: Banner sitzt alleine im Main (das kein Padding mehr
  // hat). Wrapper gibt 24px Außenabstand damit der Banner nicht edge-
  // to-edge an Sidebar/Browser klebt.
  return padded === true ? <div className="p-6">{banner}</div> : banner;
}

// ---- Field (Label + Error) ----

// Matches DefaultBanner's aria-labelledby target: a non-labelable control
// (e.g. Banner's <div>) can't take a real htmlFor, so Field always also
// gives its label a stable id that such controls can point to.
function fieldLabelId(id: string): string {
  return `${id}-label`;
}

// Boolean optics depend on the surrounding Field layout: layout="inline"
// (checkbox lists like MultiSelectCheckboxes, the BooleanField widget) keeps
// the checkbox, the standard form field (layout="stacked"/default) gets the
// new switch. Pure web-renderer rendering decision, no contract field needed
// — Field hands its resolved layout down to the nested Input via context.
const FieldLayoutContext = createContext<FieldProps["layout"]>("stacked");

// True inside the sections of a card-less screen form: sections then drop their
// own horizontal padding, the screen form's scroll surface provides it.
const ScreenFormContext = createContext(false);
const DrawerBodyContext = createContext(false);

function DefaultField({
  id,
  label,
  required,
  issues,
  labelAppendix,
  fieldAppendix,
  children,
  layout,
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
      <span className="truncate" title={typeof label === "string" ? label : undefined}>
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
      role="alert"
      data-testid={testId !== undefined ? `${testId}-errors` : undefined}
      className="text-xs text-destructive"
    >
      {issues.map((issue) => (
        <div key={`${issue.path}:${issue.code}`}>{t(issue.i18nKey, issue.params)}</div>
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
        className="inline-flex items-center gap-1 text-xs text-primary"
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {t("kumiko.form.changed")}
      </span>
    ) : null;

  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        {changedMarker !== null ? (
          <div className="flex min-w-0 items-center gap-2">
            {labelEl}
            {changedMarker}
          </div>
        ) : (
          labelEl
        )}
        {/* appendix neben dem <label>, nicht darin — interaktiver Inhalt
            (Disclosure-Button) gehört nicht in ein label-Element. */}
        {labelAppendix !== undefined && labelAppendix}
      </div>
      {/* fieldAppendix (Cascade-Detail-Panel) über dem Input — das
          aufgeklappte Detail gehört direkt unter seinen Trigger in der
          Label-Row, nicht durch den Input davon getrennt. */}
      {fieldAppendix !== undefined && fieldAppendix}
      {children}
      {errorsEl}
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

function fieldIconFor(icon: string | undefined): (typeof FIELD_ICONS)[FieldIconKey] | undefined {
  return icon !== undefined && Object.hasOwn(FIELD_ICONS, icon)
    ? FIELD_ICONS[icon as FieldIconKey]
    : undefined;
}

// Wraps a text/number input with a left-positioned prefix icon when
// `icon` carries a known FIELD_ICONS key. `pl-8` overrides (via
// tailwind-merge) only the left padding of the vendored ui/input.tsx —
// right padding and other defaults stay untouched.
function withFieldIcon(icon: string | undefined, input: ReactNode): ReactNode {
  const Icon = fieldIconFor(icon);
  if (Icon === undefined) return input;
  return (
    <div className="relative">
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      {input}
    </div>
  );
}

// Mirrors withFieldIcon on the right side: a muted, non-interactive unit
// suffix rendered inside the input's visual box. Pure decoration — never
// focusable, never touches the input's value.
function withUnitSuffix(unit: string | undefined, input: ReactNode): ReactNode {
  if (unit === undefined) return input;
  return (
    <div className="relative">
      {input}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
      >
        {unit}
      </span>
    </div>
  );
}

// Default presentation for `kind: "select"` without a `display` of its own
// (board rule): up to 3 short options read as a segmented control, up to 3
// longer ones as a vertical radio list, everything else as a dropdown. Labels
// arrive translated, so the widget can differ between UI languages (#2606).
const SEGMENTED_SELECT_MAX_OPTIONS = 3;
const SEGMENTED_SELECT_MAX_LABEL_LENGTH = 16;

type SelectPresentation = "segmented" | "radioList" | "dropdown";

function defaultSelectPresentation(
  options: readonly { readonly label: string }[],
): SelectPresentation {
  if (options.length === 0 || options.length > SEGMENTED_SELECT_MAX_OPTIONS) return "dropdown";
  return options.every((option) => option.label.length <= SEGMENTED_SELECT_MAX_LABEL_LENGTH)
    ? "segmented"
    : "radioList";
}

// A "" value is the unselected placeholder, not a real choice — a radio
// group can't render an unchecked-everything state as its own segment
// (#2606 follow-up). Filtered once so the eligibility count and the
// rendered segments never drift apart.
function withoutSegmentedSelectPlaceholder<T extends { readonly value: string }>(
  options: readonly T[],
): readonly T[] {
  return options.filter((option) => option.value !== "");
}

// WAI-ARIA radiogroup pattern (role="radiogroup" + role="radio" children):
// arrow keys move focus AND selection in the same step, only the checked
// segment (or the first when none is checked) sits in the tab order.
function SegmentedSelect({
  id,
  name,
  value,
  onChange,
  options,
  disabled,
  required,
  hasError,
}: {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
}): ReactNode {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectAt = (index: number): void => {
    const target = options[index];
    if (target === undefined) return;
    onChange(target.value);
    buttonRefs.current[index]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectAt((index + 1) % options.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectAt((index - 1 + options.length) % options.length);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={fieldLabelId(id)}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      data-testid={`segmented-${id}`}
      className={cn(
        "inline-flex min-h-9 w-fit flex-wrap overflow-hidden rounded-md border",
        hasError === true ? "border-destructive" : "border-input",
      )}
    >
      <input type="hidden" name={name} value={value} />
      {options.map((opt, index) => {
        const checked = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a native <input type="radio"> can't render the segment's label as content — button+role="radio" is the standard WAI-ARIA composite-widget substitute.
          <button
            key={opt.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (value === "" && index === 0) ? 0 : -1}
            disabled={disabled}
            data-testid={`segmented-${id}-${opt.value}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              // Per-segment top/left border instead of the container's
              // `divide-x`: divide-x only draws verticals between siblings
              // in source order, which misplaces borders the moment a
              // segment wraps to a new row (stray left border on the first
              // item of row 2, no line between the rows). The -1px margin
              // collapses each segment's own border onto its neighbour's —
              // for row/column edges it overlaps the container's border
              // instead, clipped by the container's `overflow-hidden`.
              //
              // `grow` lets segments share leftover space on a wrapped row
              // so every row spans the container's full (widest-row) width —
              // without it, a shorter last row left its right edge borderless
              // and the next row's top border cut a notch into the row above.
              // Harmless on a single-row layout: there's no leftover space to
              // grow into, so `w-fit` on the container still holds.
              "-ml-px -mt-px grow border-l border-t px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              hasError === true ? "border-destructive/50" : "border-border",
              checked
                ? "bg-primary/10 font-semibold text-primary"
                : "bg-transparent font-medium text-foreground hover:bg-accent",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const RADIO_CARD_CLASS =
  "flex items-start gap-3 rounded-lg border border-input bg-background px-[15px] py-[13px] text-sm font-normal text-foreground " +
  "has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:px-[14px] has-[:checked]:py-3 " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:opacity-50";

function RadioListSelect({
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
  }[];
  readonly variant?: "list" | "card";
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
}): ReactNode {
  const card = variant === "card";
  return (
    <div
      role="radiogroup"
      aria-labelledby={fieldLabelId(id)}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      data-testid={`radio-list-${id}`}
      data-radio-list=""
      className="flex flex-col gap-2"
    >
      {options.map((opt) => (
        <label
          key={opt.value}
          className={
            card ? RADIO_CARD_CLASS : "flex items-center gap-2 text-sm font-normal text-foreground"
          }
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={opt.value === value}
            disabled={disabled}
            data-testid={`radio-list-${id}-${opt.value}`}
            onChange={() => onChange(opt.value)}
            className={cn("size-4 accent-primary", card && "mt-0.5 shrink-0")}
          />
          {card ? (
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{opt.label}</span>
              {opt.description !== undefined && (
                <span className="text-[13px] text-foreground-secondary">{opt.description}</span>
              )}
            </span>
          ) : (
            opt.label
          )}
        </label>
      ))}
    </div>
  );
}

// The row count reaches the textarea through an untyped view-model hint, so a
// sloppy schema can hand over a fraction or a zero — neither renders a sane
// attribute nor a sane min-height, so both fall back to the default instead.
function normalizedTextareaRows(rows: number | undefined): number | undefined {
  return rows !== undefined && Number.isInteger(rows) && rows >= 1 ? rows : undefined;
}

// The vendored shadcn Textarea carries `field-sizing: content`, which derives
// the box height from the content and makes the `rows` attribute inert (#2677).
// A declared row count therefore only survives as a min-height floor: the field
// starts at `rows` lines tall and still grows with its content. The addend is
// the textarea frame — py-2 top+bottom plus the 1px borders.
function textareaMinHeight(rows: number): CSSProperties {
  return { minHeight: `calc(${rows} * 1lh + 1rem + 2px)` };
}

function DefaultInput(props: InputProps): ReactNode {
  // Vendored ui/input + ui/checkbox stylen Fehler über `aria-invalid`
  // selbst — kein manuelles border-destructive mehr nötig.
  const booleanLayout = useContext(FieldLayoutContext);
  const common = {
    id: props.id,
    name: props.name,
    disabled: props.disabled,
    "aria-required": props.required,
    "aria-invalid": props.hasError === true ? true : undefined,
  } as const;
  switch (props.kind) {
    case "text":
      return withFieldIcon(
        props.icon,
        <UiInput
          type="text"
          {...common}
          {...props.dataAttributes}
          data-testid={props.testId}
          readOnly={props.readOnly}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          onKeyDown={props.onKeyDown}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          {...(props.autoComplete !== undefined && { autoComplete: props.autoComplete })}
          className={cn(fieldIconFor(props.icon) !== undefined ? "pl-8" : undefined)}
        />,
      );
    case "email":
      return (
        <UiInput
          type="email"
          {...common}
          data-testid={props.testId}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          autoComplete={props.autoComplete ?? "email"}
        />
      );
    case "password":
      return (
        <UiInput
          type="password"
          {...common}
          data-testid={props.testId}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          autoComplete={props.autoComplete ?? "current-password"}
        />
      );
    case "number":
      return withUnitSuffix(
        props.unit,
        withFieldIcon(
          props.icon,
          <NumberInput
            id={props.id}
            name={props.name}
            value={props.value}
            onChange={props.onChange}
            disabled={props.disabled}
            required={props.required}
            hasError={props.hasError}
            testId={props.testId}
            {...(props.locale !== undefined && { locale: props.locale })}
            {...(props.grouping !== undefined && { grouping: props.grouping })}
            {...(props.integer !== undefined && { integer: props.integer })}
            {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
            className={cn(
              fieldIconFor(props.icon) !== undefined ? "pl-8" : undefined,
              props.unit !== undefined ? "pr-8" : undefined,
            )}
          />,
        ),
      );
    case "range":
      return (
        <input
          type="range"
          {...common}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(Number(e.target.value))}
          className="w-full accent-primary"
        />
      );
    case "boolean":
      // layout="inline" (checkbox lists like MultiSelectCheckboxes, the
      // BooleanField widget) keeps the checkbox optics; the standard form
      // field (render-field.tsx, layout="stacked") gets the switch.
      return booleanLayout === "inline" ? (
        <Checkbox
          id={props.id}
          name={props.name}
          disabled={props.disabled}
          aria-required={props.required}
          aria-invalid={props.hasError === true ? true : undefined}
          checked={props.value}
          onCheckedChange={(checked) => props.onChange(checked === true)}
        />
      ) : (
        <Switch
          id={props.id}
          name={props.name}
          disabled={props.disabled}
          aria-required={props.required}
          aria-invalid={props.hasError === true ? true : undefined}
          checked={props.value}
          onCheckedChange={(checked) => props.onChange(checked === true)}
          className="aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
        />
      );
    case "file":
    case "image":
      return (
        <FileUploadInput
          kind={props.kind}
          id={props.id}
          value={props.value}
          onChange={props.onChange}
          {...(props.accept !== undefined && { accept: props.accept })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.entityType !== undefined && { entityType: props.entityType })}
          {...(props.fieldName !== undefined && { fieldName: props.fieldName })}
          {...(props.imageVariant !== undefined && { imageVariant: props.imageVariant })}
          {...(props.capture !== undefined && { capture: props.capture })}
        />
      );
    case "date":
      return (
        <DateInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "select": {
      // Visual-Konsolidierung: alle Selects laufen über ComboboxInput
      // (cmdk + Radix-Popover). Vorher hatten wir zwei Pfade — Radix-
      // Select für `kind:"select"` und cmdk für `kind:"combobox"`. Drei
      // visuell unterschiedliche Variants (Single-Select, Combobox-
      // Single, Combobox-Multi) wurden unhandbar. Mit dem Merge ist die
      // Combobox die einzige Implementation: Search-Input ist auch bei
      // 4-Item-Status-Selects vorhanden, das ist eine bewusst akzeptierte
      // UX-Konsequenz für Style-Konsistenz.
      const comboOptions = props.options.map((o) =>
        typeof o === "string" ? { value: o, label: o } : o,
      );
      // The radio group can't render the unselected placeholder as its own
      // segment, so it counts and renders on the real options only — the
      // dropdown below keeps comboOptions (placeholder included) since it
      // has a genuine "nothing selected" row.
      // An author who asks for `display: "radio"` explicitly declared the ""
      // option as a real choice (e.g. "Any"), so it stays a segment.
      const radioGroupOptions =
        props.display === "radio" ? comboOptions : withoutSegmentedSelectPlaceholder(comboOptions);
      // An explicit `display` is an author decision and outranks the
      // heuristic in both directions — a requested radio group renders as
      // one even when the options outnumber the heuristic's threshold (#2711).
      const presentation =
        props.radioVariant === "card"
          ? "radioList"
          : props.display === "radio"
            ? "segmented"
            : props.display === "dropdown"
              ? "dropdown"
              : defaultSelectPresentation(radioGroupOptions);
      if (presentation === "radioList" && radioGroupOptions.length > 0) {
        return (
          <RadioListSelect
            id={props.id}
            name={props.name}
            value={props.value}
            onChange={props.onChange}
            options={radioGroupOptions}
            {...(props.radioVariant !== undefined && { variant: props.radioVariant })}
            {...(props.disabled !== undefined && { disabled: props.disabled })}
            {...(props.required !== undefined && { required: props.required })}
            {...(props.hasError !== undefined && { hasError: props.hasError })}
          />
        );
      }
      if (presentation === "segmented" && radioGroupOptions.length > 0) {
        return (
          <SegmentedSelect
            id={props.id}
            name={props.name}
            value={props.value}
            onChange={props.onChange}
            options={radioGroupOptions}
            {...(props.disabled !== undefined && { disabled: props.disabled })}
            {...(props.required !== undefined && { required: props.required })}
            {...(props.hasError !== undefined && { hasError: props.hasError })}
          />
        );
      }
      return (
        <ComboboxInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          options={comboOptions}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    }
    case "combobox": {
      // Tier 2.1c + Tier 2.7e: Discriminated-Union per `multiple` —
      // wir splittan TS-side in zwei Branches damit ComboboxInput's
      // Single/Multi-Variants typgerecht gerendert werden.
      const baseProps = {
        id: props.id,
        name: props.name,
        options: props.options,
        ...(props.disabled !== undefined && { disabled: props.disabled }),
        ...(props.required !== undefined && { required: props.required }),
        ...(props.hasError !== undefined && { hasError: props.hasError }),
        ...(props.placeholder !== undefined && { placeholder: props.placeholder }),
        ...(props.searchPlaceholder !== undefined && {
          searchPlaceholder: props.searchPlaceholder,
        }),
        ...(props.emptyText !== undefined && { emptyText: props.emptyText }),
        ...(props.onSearchChange !== undefined && { onSearchChange: props.onSearchChange }),
        ...(props.loading !== undefined && { loading: props.loading }),
        ...(props.onCreate !== undefined && { onCreate: props.onCreate }),
        ...(props.createLabel !== undefined && { createLabel: props.createLabel }),
      } as const;
      if (props.multiple === true) {
        return (
          <ComboboxInput {...baseProps} multiple value={props.value} onChange={props.onChange} />
        );
      }
      return <ComboboxInput {...baseProps} value={props.value} onChange={props.onChange} />;
    }
    case "money":
      return (
        <MoneyInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          currency={props.currency ?? "EUR"}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "timestamp":
      return (
        <TimestampInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.wallClock !== undefined && { wallClock: props.wallClock })}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "locatedTimestamp":
      return (
        <LocatedTimestampInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "textarea": {
      const rows = normalizedTextareaRows(props.rows);
      const onSubmitShortcut = props.onSubmitShortcut;
      const onKeyDown = props.onKeyDown;
      return (
        <Textarea
          {...common}
          {...props.dataAttributes}
          readOnly={props.readOnly}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value)}
          rows={rows ?? 4}
          className="resize-y"
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          {...(rows !== undefined && { style: textareaMinHeight(rows) })}
          {...((onSubmitShortcut !== undefined || onKeyDown !== undefined) && {
            ...(onSubmitShortcut !== undefined && {
              "aria-keyshortcuts": "Control+Enter Meta+Enter",
            }),
            onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
              onKeyDown?.(e);
              if (onSubmitShortcut === undefined || e.key !== "Enter" || !(e.metaKey || e.ctrlKey))
                return;
              e.preventDefault();
              onSubmitShortcut();
            },
          })}
        />
      );
    }
    case "tz":
      return (
        <TzInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
  }
}

// ---- DataTable (shadcn: Table) ----

function sameValueSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

// Single-choice chip row for a facet with `chips`: a chip is pressed while the
// current selection equals its values, a click replaces the selection.
function FacetChips({
  facet,
  selected,
  onChange,
}: {
  facet: DataTableFacet;
  selected: readonly string[];
  onChange: (field: string, values: readonly string[]) => void;
}): ReactNode {
  const chips = (facet.chips ?? []).filter(
    (chip) => facet.hideEmpty !== true || chip.count !== 0 || sameValueSet(selected, chip.values),
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings browser default borders/legend layout the chip row must not have
    <div
      role="group"
      aria-label={facet.label}
      className="flex flex-wrap items-center gap-1.5"
      data-testid={`facet-${facet.field}`}
    >
      {chips.map((chip) => (
        <DefaultButton
          key={chip.id}
          variant="secondary"
          size="sm"
          pressed={sameValueSet(selected, chip.values)}
          onClick={() => onChange(facet.field, chip.values)}
          testId={`facet-${facet.field}-${chip.id}`}
          className="rounded-full"
        >
          {chip.label}
          {facet.showCounts === true && chip.count !== undefined && (
            <span className="tabular-nums text-muted-foreground">{chip.count}</span>
          )}
        </DefaultButton>
      ))}
    </div>
  );
}

// Faceted-Filter-Dropdown: Outline-Button (wie shadcns "Columns"-Toggle) +
// Multi-Select-Checkboxen. Aktive Auswahl → Count-Badge am Button.
function FacetFilter({
  facet,
  selected,
  onChange,
  dense = false,
}: {
  facet: DataTableFacet;
  selected: readonly string[];
  onChange: (field: string, values: readonly string[]) => void;
  /** Toolbar of a scrollBody table: h32 with the stronger border. */
  dense?: boolean;
}): ReactNode {
  const toggle = (value: string, checked: boolean): void => {
    const next = checked ? [...selected, value] : selected.filter((v) => v !== value);
    onChange(facet.field, next);
  };
  if (facet.chips !== undefined) {
    return <FacetChips facet={facet} selected={selected} onChange={onChange} />;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <UiButton
          variant="outline"
          size="sm"
          className={cn("h-9", dense && "h-8 border-border-strong px-2.5 max-md:h-11")}
          data-testid={`facet-${facet.field}`}
        >
          {facet.label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 rounded-sm px-1 font-normal tabular-nums">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="text-muted-foreground" />
        </UiButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {facet.options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.includes(opt.value)}
            onCheckedChange={(checked: boolean) => toggle(opt.value, checked)}
            onSelect={(e: Event) => e.preventDefault()}
            data-testid={`facet-${facet.field}-${opt.value}`}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Time-range filter (fw#3104): two native <input type="date"> instead of a
// dropdown — the browser supplies the calendar, the locale and the keyboard
// handling, so no date dependency is needed. Each bound constrains the other
// through min/max so the picker can't offer an inverted span; the caller
// clamps a typed value on top of that.
function DateRangeFacetFilter({
  facet,
  onChange,
}: {
  facet: DataTableDateRangeFacet;
  onChange: (field: string, bound: "from" | "to", value: string) => void;
}): ReactNode {
  const inputClass =
    "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:min-h-11";
  return (
    <div className="flex items-center gap-2" data-testid={`facet-daterange-${facet.field}`}>
      <span className="text-sm text-muted-foreground">{facet.label}</span>
      <input
        type="date"
        className={inputClass}
        value={facet.from}
        {...(facet.to !== "" && { max: facet.to })}
        aria-label={`${facet.label} from`}
        data-testid={`facet-daterange-${facet.field}-from`}
        onChange={(e) => onChange(facet.field, "from", e.target.value)}
      />
      <span className="text-sm text-muted-foreground">–</span>
      <input
        type="date"
        className={inputClass}
        value={facet.to}
        {...(facet.from !== "" && { min: facet.from })}
        aria-label={`${facet.label} to`}
        data-testid={`facet-daterange-${facet.field}-to`}
        onChange={(e) => onChange(facet.field, "to", e.target.value)}
      />
    </div>
  );
}

// The vendored Table wraps <table> in an `overflow-x-auto` container, which
// would become the scrollport of a sticky header. A scrollBody table scrolls
// in its parent instead, so it renders the bare <table>.
function FlushTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>): ReactNode {
  return (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  );
}

// Header cells stick to the scroll surface; the bottom rule is an inset
// shadow because a border on a sticky cell scrolls away under border-collapse.
// Column weight (medium vs. semibold for the sorted one) lives on the th itself
// in SortableHeader: a `[&_th]:font-*` rule here would outrank it.
// Child selectors only: an expanded row nests a whole table inside a cell, and
// descendant selectors would make its header sticky and re-pad its cells.
const FILL_TABLE_CLASS = cn(
  "[&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10 [&>thead>tr>th]:h-9 [&>thead>tr>th]:bg-muted [&>thead>tr>th]:px-2 [&>thead>tr>th]:text-[13px]",
  "[&>thead>tr>th]:shadow-[inset_0_-1px_0_var(--color-border)] [&>thead>tr>th_button]:text-[13px] [&>tbody>tr>td]:px-2 [&>tbody>tr>td]:py-0",
  "[&>*>tr>:first-child]:pl-6 [&>*>tr>:last-child]:pr-6",
);

// `!`: beats the first/last-child padding of FILL_TABLE_CLASS, which would
// otherwise widen the narrow toggle column / pad the full-width expansion cell.
// The nested table's sticky actions cell (last td) gets the muted surface
// instead of its own md:bg-background, so it blends into the area.
const EXPAND_TOGGLE_CELL_CLASS = "w-10 px-1! py-0!";
const EXPANSION_CELL_CLASS =
  "whitespace-normal bg-muted p-0! align-top md:[&_td:last-child]:bg-muted";
const EXPANSION_CONTENT_CLASS = "pt-1 pr-4 pb-3.5 pl-[52px]";

function RowExpandToggle({
  expanded,
  controlsId,
  label,
  onToggle,
  testId,
}: {
  readonly expanded: boolean;
  readonly controlsId: string;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testId: string;
}): ReactNode {
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-expanded={expanded}
      {...(expanded && { "aria-controls": controlsId })}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <ChevronRight
        className={cn("size-4 transition-transform", expanded && "rotate-90")}
        aria-hidden="true"
      />
    </UiButton>
  );
}

const TABLE_FOOTER_BAR_CLASS = cn(
  "flex h-15 shrink-0 items-center gap-4 border-t border-border bg-card pl-4 pr-2",
  "text-[13px] tabular-nums text-foreground-secondary md:h-11 md:px-6",
);

function DataTableFooter({
  count,
  itemNoun,
  testId,
}: {
  readonly count: number;
  readonly itemNoun?: (count: number) => string;
  readonly testId: string;
}): ReactNode {
  const t = useOptionalTranslation();
  const noun = itemNoun?.(count);
  const label =
    noun !== undefined
      ? (t?.("kumiko.list.count.noun", { count: count.toLocaleString(), noun }) ??
        `${count.toLocaleString()} ${noun}`)
      : count === 1
        ? (t?.("kumiko.list.count.one") ?? "1 entry")
        : (t?.("kumiko.list.count.other", { count: count.toLocaleString() }) ??
          `${count.toLocaleString()} entries`);
  return (
    <div data-testid={testId} className={TABLE_FOOTER_BAR_CLASS}>
      <span data-testid={`${testId}-count`}>{label}</span>
    </div>
  );
}

const CARD_META_MAX = 3;

function DefaultDataTable({
  columns,
  rows,
  onRowClick,
  sort,
  onSortChange,
  emptyState,
  toolbarStart,
  toolbarDescription,
  toolbarEnd,
  pager,
  onReachEnd,
  loadingMore,
  hasMore,
  itemNoun,
  rowActions,
  rowActionMode,
  rowGrouping,
  rowTone,
  filterFacets,
  filterValues,
  onFilterChange,
  onFilterReset,
  dateRangeFacets,
  onDateRangeChange,
  testId,
  onCellChange,
  getRowTestId,
  getCellTestId,
  chromeless,
  scrollBody,
  screenPadding,
  expandedRowIds,
  onToggleRowExpanded,
  renderExpandedRow,
}: DataTableProps): ReactNode {
  // One locale/translate subscription per table — not per cell (fw#2345).
  // Optional hooks: a bare DataTable outside LocaleProvider must not crash.
  const tableTranslate = useOptionalTranslation();
  const tableLocale = useOptionalLocale();
  // Below 768px a table scrolls its columns out of reach with no visible
  // affordance (fw#2159 fixed the desktop case; narrow viewports never had
  // one). Cards replace the table entirely below the breakpoint — same
  // single-mount pattern as EmbeddedListInput/embedded-list-input.tsx.
  const isNarrow = useIsNarrowViewport();
  const [facetsOpenNarrow, setFacetsOpenNarrow] = useState(false);
  const [toggledGroups, setToggledGroups] = useState<ReadonlySet<string>>(new Set());
  // Toolbar-Wrapper: gemeinsamer Container für Toolbar+Tabelle damit
  // beide visuell zusammengehören. Toolbar ist NICHT sticky — Lists
  // scrollen typischerweise mit dem Page-Container, nicht intern.
  // Sticky würde mit der Topbar konkurrieren.
  // The row click already runs rowClick actions, so with a clickable row they
  // must not reappear in the kebab (a list whose only action is the rowClick
  // one gets no actions column at all).
  const rowIsLink = onRowClick !== undefined;
  const menuActions =
    rowActions !== undefined && rowIsLink
      ? rowActions.filter((action) => action.rowClick !== true)
      : rowActions;
  // The table keeps every action in "inline" mode, and with editable cells the
  // first cell is not a keyboard link (FirstCellLink is off), so the kebab is
  // then the only keyboard route to the rowClick action.
  const tableActions =
    rowActionMode === "inline" || onCellChange !== undefined ? rowActions : menuActions;
  const rowClickLabel = rowActions?.find((action) => action.rowClick === true)?.label;
  const hasTableActions = tableActions !== undefined && tableActions.length > 0;
  const isEmpty = rows.length === 0;
  const expansionIdPrefix = useId();
  const isRowExpandable = renderExpandedRow !== undefined && onToggleRowExpanded !== undefined;
  const rowTestId = (row: ListRowViewModel): string => getRowTestId?.(row) ?? `row-${row.id}`;
  const expansionDomId = (row: ListRowViewModel): string => `${expansionIdPrefix}-${row.id}`;
  // The expand toggle of a row, shared by table and card layout. Named after
  // the first data column, the one a user recognizes the row by.
  function renderExpandToggle(row: ListRowViewModel): ReactNode {
    if (!isRowExpandable) return null;
    const expanded = expandedRowIds?.has(row.id) === true;
    const firstColumn = columns[0];
    const title =
      (firstColumn !== undefined ? cellTitle(row.values[firstColumn.field]) : undefined) ?? "";
    const labelKey = expanded ? "kumiko.list.row.collapse" : "kumiko.list.row.expand";
    return (
      <RowExpandToggle
        expanded={expanded}
        controlsId={expansionDomId(row)}
        label={
          tableTranslate?.(labelKey, { title }) ?? `${expanded ? "Collapse" : "Expand"} ${title}`
        }
        onToggle={() => onToggleRowExpanded(row.id)}
        testId={`${rowTestId(row)}-toggle`}
      />
    );
  }
  function renderExpansion(row: ListRowViewModel, as: "row" | "item", colSpan: number): ReactNode {
    if (!isRowExpandable || expandedRowIds?.has(row.id) !== true) return null;
    const content = renderExpandedRow(row);
    if (as === "item") {
      return (
        <li
          id={expansionDomId(row)}
          data-testid={`${rowTestId(row)}-expansion`}
          className="border-b border-border-row bg-muted px-4 pt-1 pb-3.5"
        >
          {content}
        </li>
      );
    }
    return (
      <TableRow
        id={expansionDomId(row)}
        data-testid={`${rowTestId(row)}-expansion`}
        className="hover:bg-transparent"
      >
        <TableCell colSpan={colSpan} className={EXPANSION_CELL_CLASS}>
          <div className={EXPANSION_CONTENT_CLASS}>{content}</div>
        </TableCell>
      </TableRow>
    );
  }
  const fillsHeight = scrollBody === true;
  const TableRoot = fillsHeight ? FlushTable : Table;
  const emptyBlock: ReactNode = (
    <div
      data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
      className={cn(
        "flex flex-col items-center justify-center p-12 text-sm text-muted-foreground gap-3",
        chromeless !== true && !fillsHeight && "rounded-md border border-dashed",
      )}
    >
      {emptyState ?? <span>{tableTranslate?.("kumiko.list.no-entries") ?? "No entries."}</span>}
    </div>
  );

  const tableItems = buildTableItems(rows, rowGrouping, toggledGroups);

  function renderGroupToggle(item: Extract<TableItem, { kind: "group" }>): ReactNode {
    return (
      <button
        type="button"
        aria-expanded={!item.collapsed}
        data-testid={`row-group-${item.key}-toggle`}
        onClick={() =>
          setToggledGroups((prev) => {
            const next = new Set(prev);
            if (!next.delete(item.key)) next.add(item.key);
            return next;
          })
        }
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-foreground-secondary"
      >
        {item.collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
        {item.label}
      </button>
    );
  }

  function tableInner(): ReactNode {
    if (isEmpty) return emptyBlock;
    return (
      // dashboard-01-Muster: `rounded-lg border`-Rahmen, die Header-Zeile
      // trägt den bg-muted-Grauton. `bg-card` (statt transparent) → die Liste
      // sitzt auf derselben Card-Fläche wie Forms; auf Themes mit farbigem
      // Page-Background (z.B. Cream) matchen Listen sonst nicht die Cards.
      // `chromeless` drops that frame for a host with its own boundary already (a tab panel, fw#2722).
      // `scrollBody`: the scroll surface and its border live on the wrapper
      // in `content` below, so the table renders frameless and without the
      // vendored `overflow-x-auto` container — that container would become
      // the sticky header's scrollport and the header would never stick.
      <div
        className={cn(
          !fillsHeight && "overflow-hidden",
          !fillsHeight && chromeless !== true && "rounded-lg border bg-card",
        )}
      >
        <TableRoot data-testid={testId} className={fillsHeight ? FILL_TABLE_CLASS : undefined}>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-transparent">
              {isRowExpandable && (
                <TableHead data-testid="column-expand" className={EXPAND_TOGGLE_CELL_CLASS} />
              )}
              {columns.map((col) => (
                <SortableHeader
                  key={col.field}
                  field={col.field}
                  label={col.label}
                  sortable={col.sortable === true}
                  highlighted={col.highlighted === true}
                  numeric={NUMERIC_COLUMN_TYPES.has(col.type)}
                  {...(sort !== undefined && sort !== null && { sort })}
                  {...(onSortChange !== undefined && { onSortChange })}
                />
              ))}
              {hasTableActions && (
                <TableHead
                  data-testid="column-actions"
                  // From md: sticky right-0 + bg-muted (= header tone) so the
                  // action column stays at the right edge during horizontal
                  // scroll on wider screens. Below md, actions scroll in
                  // normal flow — sticky there would pin the column over the
                  // preceding data column instead of the (already narrow)
                  // page edge. No border-l: a permanent divider looks heavy;
                  // the sticky bg already sets the column apart during scroll.
                  className="w-px text-right text-muted-foreground md:sticky md:right-0 md:z-10 md:bg-muted"
                  aria-label="Actions"
                />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableItems.map((item) => {
              if (item.kind === "group") {
                return (
                  <TableRow key={`group-${item.key}`} data-testid={`row-group-${item.key}`}>
                    <TableCell
                      colSpan={
                        columns.length + (isRowExpandable ? 1 : 0) + (hasTableActions ? 1 : 0)
                      }
                      className="bg-muted/40 p-0"
                    >
                      {renderGroupToggle(item)}
                    </TableCell>
                  </TableRow>
                );
              }
              const row = item.row;
              return (
                <Fragment key={row.id}>
                  <TableRow
                    data-testid={rowTestId(row)}
                    data-tone={rowTone?.(row)}
                    onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
                    className={cn(
                      rowToneClass(rowTone?.(row)),
                      onRowClick !== undefined && "cursor-pointer",
                      fillsHeight && "h-10 border-border-row hover:bg-muted",
                    )}
                  >
                    {isRowExpandable && (
                      <TableCell
                        data-testid={getCellTestId?.(row, "expand") ?? `cell-${row.id}-expand`}
                        className={EXPAND_TOGGLE_CELL_CLASS}
                      >
                        {renderExpandToggle(row)}
                      </TableCell>
                    )}
                    {columns.map((col, colIndex) => (
                      <TableCell
                        key={col.field}
                        data-testid={
                          getCellTestId?.(row, col.field) ?? `cell-${row.id}-${col.field}`
                        }
                        data-highlighted={col.highlighted === true ? "true" : undefined}
                        // Cells truncate long values with ellipsis instead of
                        // wrapping — lists stay single-line + scannable (Linear
                        // pattern). max-w-xs gives a sensible default upper
                        // bound; the table container scrolls horizontally
                        // if the sum of the columns gets too wide.
                        className={cn(
                          "max-w-xs truncate",
                          colIndex === 0
                            ? "font-medium text-foreground"
                            : "text-foreground-secondary",
                          NUMERIC_COLUMN_TYPES.has(col.type) && "text-right",
                          TABULAR_COLUMN_TYPES.has(col.type) && "tabular-nums",
                          col.highlighted === true && "bg-accent/40",
                        )}
                        title={cellTitle(row.values[col.field])}
                      >
                        <FirstCellLink
                          enabled={
                            colIndex === 0 && onRowClick !== undefined && onCellChange === undefined
                          }
                          onOpen={() => onRowClick?.(row)}
                          empty={isEmptyCellValue(row.values[col.field])}
                          emptyLabel={rowClickLabel}
                        >
                          <DataTableCell
                            value={row.values[col.field]}
                            row={row.values}
                            field={col.field}
                            type={col.type}
                            renderer={col.renderer}
                            translate={tableTranslate}
                            locale={tableLocale}
                            {...(col.optionLabels !== undefined && {
                              optionLabels: col.optionLabels,
                            })}
                            {...(col.optionTones !== undefined && { optionTones: col.optionTones })}
                            {...(col.grouping !== undefined && { grouping: col.grouping })}
                            {...(onCellChange !== undefined && {
                              onChange: (value: unknown) => onCellChange(row.id, col.field, value),
                            })}
                          />
                        </FirstCellLink>
                      </TableCell>
                    ))}
                    {hasTableActions && (
                      <TableCell
                        data-testid={getCellTestId?.(row, "actions") ?? `cell-${row.id}-actions`}
                        // From md: sticky-right so the actions stay visible on the
                        // right edge during horizontal scroll. Below md, actions
                        // scroll with the row like any other cell — sticky there
                        // would hide the neighboring data column on narrow
                        // viewports. bg-background sets the column apart during
                        // scroll — no border-l (divider too heavy).
                        className={cn(
                          "text-right md:sticky md:right-0 md:z-10 md:bg-background",
                          fillsHeight && "md:bg-card",
                        )}
                        // Action-cell events must not trigger the row click/activation
                        // (typically "Open Detail" — the user wanted the action,
                        // not navigation). We stopPropagation for mouse and
                        // keyboard so a11y stays consistent.
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <RowActionsCell
                          row={row}
                          actions={tableActions}
                          mode={rowActionMode}
                          rowIsLink={rowIsLink}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                  {renderExpansion(
                    row,
                    "row",
                    columns.length + (isRowExpandable ? 1 : 0) + (hasTableActions ? 1 : 0),
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </TableRoot>
      </div>
    );
  }

  // No column headers below the breakpoint, so the click-to-sort affordance
  // on SortableHeader has nothing to attach to. A single native <select> is
  // the whole fix — no custom widget, no menu — fed straight from the
  // columns marked sortable in the ViewModel. Options carry the resolved
  // {field, dir} directly so onChange can look the pick up by value instead
  // of parsing/casting the option string back apart.
  const sortableColumns = columns.filter((col) => col.sortable);
  const sortOptions: readonly {
    readonly value: string;
    readonly field: string;
    readonly dir: DataTableSortDir;
    readonly label: string;
  }[] = sortableColumns.flatMap((col) => [
    { value: `${col.field}:asc`, field: col.field, dir: "asc", label: `${col.label} ↑` },
    { value: `${col.field}:desc`, field: col.field, dir: "desc", label: `${col.label} ↓` },
  ]);

  const cardTitleColumn = columns.find((col) => col.highlighted === true) ?? columns[0];
  const cardStatusColumn = columns.find(
    (col) => col !== cardTitleColumn && col.type === "select" && col.renderer === undefined,
  );
  const cardMetaColumns = columns.filter(
    (col) => col !== cardTitleColumn && col !== cardStatusColumn && col.hideOnNarrow !== true,
  );

  function cardCell(row: ListRowViewModel, col: (typeof columns)[number]): ReactNode {
    // A bare check mark in the subtitle line says nothing without its column.
    if (showsBareCheckMark(col.type, row.values[col.field], col.renderer)) return col.label;
    return (
      <DataTableCell
        value={row.values[col.field]}
        row={row.values}
        field={col.field}
        type={col.type}
        renderer={col.renderer}
        translate={tableTranslate}
        locale={tableLocale}
        {...(col.optionLabels !== undefined && { optionLabels: col.optionLabels })}
        {...(col.optionTones !== undefined && { optionTones: col.optionTones })}
        {...(col.grouping !== undefined && { grouping: col.grouping })}
        {...(onCellChange !== undefined && {
          onChange: (value: unknown) => onCellChange(row.id, col.field, value),
        })}
      />
    );
  }

  function renderCard(row: ListRowViewModel): ReactNode {
    const metaColumns = cardMetaColumns
      .filter(
        (col) =>
          !isEmptyCellValue(row.values[col.field]) &&
          !isUnlabeledFalse(col.type, row.values[col.field], col.renderer),
      )
      .slice(0, CARD_META_MAX);
    const showStatus =
      cardStatusColumn !== undefined && !isEmptyCellValue(row.values[cardStatusColumn.field]);
    const hasMenu = menuActions !== undefined && menuActions.length > 0;
    const body = (
      <>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            {cardTitleColumn !== undefined && (
              <span
                data-testid={
                  getCellTestId?.(row, cardTitleColumn.field) ??
                  `cell-${row.id}-${cardTitleColumn.field}`
                }
                className="min-w-0 truncate text-base font-semibold text-foreground"
              >
                {cardCell(row, cardTitleColumn)}
              </span>
            )}
            {showStatus && (
              <span
                data-testid={
                  getCellTestId?.(row, cardStatusColumn.field) ??
                  `cell-${row.id}-${cardStatusColumn.field}`
                }
                className="shrink-0"
              >
                {cardCell(row, cardStatusColumn)}
              </span>
            )}
          </div>
          {metaColumns.length > 0 && (
            // The "·" is a real element, not ::before content: consumers Tailwind-scan the published
            // dist, where the arbitrary content class is never generated. The row is shifted 12px
            // left inside an overflow-hidden box, so the separator of whichever item starts a line
            // (first item or a wrapped one) is clipped.
            <div className="min-w-0 max-h-10 overflow-hidden text-[13px] leading-5 tabular-nums text-foreground-secondary">
              <div
                data-testid={`card-meta-${row.id}`}
                className="-ml-3 flex flex-wrap items-center"
              >
                {metaColumns.map((col) => (
                  <span key={col.field} className="flex min-w-0 max-w-full items-center">
                    <span aria-hidden="true" className="w-3 shrink-0 text-center">
                      ·
                    </span>
                    <span
                      data-testid={getCellTestId?.(row, col.field) ?? `cell-${row.id}-${col.field}`}
                      className="min-w-0 truncate"
                    >
                      {isBadgeColumn(col) ? (
                        <span className="inline-flex align-middle">{cardCell(row, col)}</span>
                      ) : (
                        cardCell(row, col)
                      )}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {rowIsLink && (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </>
    );
    const rowItem = (
      <li
        key={row.id}
        data-testid={rowTestId(row)}
        data-tone={rowTone?.(row)}
        className={cn(
          "flex min-h-[72px] items-center gap-2 border-b border-border-row py-3",
          rowToneClass(rowTone?.(row)),
          isRowExpandable ? "pl-2" : "pl-4",
          hasMenu ? "pr-2" : "pr-4",
        )}
        {...(rowIsLink && { onClick: () => onRowClick(row) })}
      >
        {renderExpandToggle(row)}
        {rowIsLink ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent p-0 text-left"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              onRowClick(row);
            }}
          >
            {body}
          </button>
        ) : (
          body
        )}
        {hasMenu && (
          // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — not a control
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <RowActionsCell
              row={row}
              actions={menuActions}
              mode={rowActionMode}
              rowIsLink={rowIsLink}
            />
          </div>
        )}
      </li>
    );
    if (!isRowExpandable) return rowItem;
    // The expansion is a sibling <li>, outside the row's click target, so
    // clicks in the sub-area never navigate the parent row.
    return (
      <Fragment key={row.id}>
        {rowItem}
        {renderExpansion(row, "item", 0)}
      </Fragment>
    );
  }

  function cardsInner(): ReactNode {
    if (isEmpty) return emptyBlock;
    const sortLabel =
      sort !== undefined && sort !== null
        ? (tableTranslate?.("kumiko.list.sort.by", {
            column: columns.find((col) => col.field === sort.field)?.label ?? sort.field,
          }) ?? `Sorted by ${sort.field}`)
        : (tableTranslate?.("kumiko.list.sort.unsorted") ?? "Unsorted");
    const SortArrow = sort?.dir === "desc" ? ArrowDown : ArrowUp;
    return (
      <div
        data-testid={testId !== undefined ? `${testId}-cards` : "render-list-cards"}
        className="flex flex-col"
      >
        {onSortChange !== undefined && sortableColumns.length > 0 && (
          <div className="relative flex h-9 items-center gap-1.5 px-4 text-[13px] text-foreground-secondary">
            <span aria-hidden="true">{sortLabel}</span>
            {sort !== undefined && sort !== null && (
              <SortArrow className="size-3.5" aria-hidden="true" />
            )}
            <select
              aria-label={tableTranslate?.("kumiko.list.sort.label") ?? "Sort"}
              data-testid={testId !== undefined ? `${testId}-sort` : "render-list-sort"}
              value={sort !== undefined && sort !== null ? `${sort.field}:${sort.dir}` : ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  onSortChange(null);
                  return;
                }
                const picked = sortOptions.find((o) => o.value === raw);
                if (picked === undefined) return;
                onSortChange({ field: picked.field, dir: picked.dir });
              }}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            >
              <option value="">
                {tableTranslate?.("kumiko.list.sort.unsorted") ?? "Unsorted"}
              </option>
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <ul className="m-0 list-none border-t border-border-row p-0">
          {tableItems.map((item) =>
            item.kind === "group" ? (
              <li
                key={`group-${item.key}`}
                data-testid={`row-group-${item.key}`}
                className="border-b border-border-row bg-muted/40"
              >
                {renderGroupToggle(item)}
              </li>
            ) : (
              renderCard(item.row)
            ),
          )}
        </ul>
      </div>
    );
  }

  const tableContent = isNarrow ? cardsInner() : tableInner();

  // Pager wird IMMER unter der Tabelle gerendert (auch bei rows=[]),
  // damit der User bei einem Filter-Hit-of-Zero zurückblättern kann
  // ohne die Liste zu verlieren. Außer total === 0 — dann gibt's
  // nichts zu paginieren. Inkompatibel mit Infinite-Scroll: Caller
  // setzt entweder pager ODER onReachEnd.
  const pagerElement =
    pager !== undefined && pager.total > 0 ? (
      <Pager
        page={pager.page}
        limit={pager.limit}
        total={pager.total}
        onPageChange={pager.onPageChange}
        {...(pager.pageSizeOptions !== undefined && { pageSizeOptions: pager.pageSizeOptions })}
        {...(pager.onPageSizeChange !== undefined && { onPageSizeChange: pager.onPageSizeChange })}
        {...(itemNoun !== undefined && { itemNoun })}
        testId={testId !== undefined ? `${testId}-pager` : "render-list-pager"}
        pinned={fillsHeight}
      />
    ) : undefined;
  const sentinelElement =
    pagerElement === undefined && onReachEnd !== undefined ? (
      <InfiniteSentinel
        onReachEnd={onReachEnd}
        loadingMore={loadingMore === true}
        hasMore={hasMore !== false}
        rowsCount={rows.length}
        testId={testId !== undefined ? `${testId}-sentinel` : "render-list-sentinel"}
      />
    ) : undefined;

  // With scrollBody the footer (pager, else the entry count) sits OUTSIDE the
  // scroll surface so it stays put at any row count; the infinite sentinel
  // stays INSIDE, or it would never intersect the scrollport.
  const content = fillsHeight ? (
    <>
      <div
        data-testid={testId !== undefined ? `${testId}-scroll` : "render-list-scroll"}
        className="min-h-0 flex-1 overflow-auto border-t border-border bg-card"
      >
        {tableContent}
        {sentinelElement}
      </div>
      {pagerElement ?? (
        <DataTableFooter
          count={rows.length}
          {...(itemNoun !== undefined && { itemNoun })}
          testId={testId !== undefined ? `${testId}-footer` : "render-list-footer"}
        />
      )}
    </>
  ) : (
    <>
      {tableContent}
      {pagerElement}
      {sentinelElement}
    </>
  );

  const hasFacets =
    filterFacets !== undefined && filterFacets.length > 0 && onFilterChange !== undefined;
  const hasDateRangeFacets =
    dateRangeFacets !== undefined && dateRangeFacets.length > 0 && onDateRangeChange !== undefined;
  const hasActiveFilters =
    filterValues !== undefined && Object.values(filterValues).some((v) => v.length > 0);
  const facetCluster =
    hasFacets || hasDateRangeFacets ? (
      <div className="flex flex-wrap items-center gap-2">
        {hasFacets &&
          filterFacets.map((facet) => (
            <FacetFilter
              key={facet.field}
              facet={facet}
              selected={filterValues?.[facet.field] ?? []}
              onChange={onFilterChange}
              dense={fillsHeight}
            />
          ))}
        {hasDateRangeFacets &&
          dateRangeFacets.map((facet) => (
            <DateRangeFacetFilter key={facet.field} facet={facet} onChange={onDateRangeChange} />
          ))}
        {hasActiveFilters && onFilterReset !== undefined && (
          <UiButton
            variant="ghost"
            size="sm"
            className="h-9 px-2"
            onClick={onFilterReset}
            data-testid="facet-reset"
          >
            {tableTranslate?.("kumiko.list.filter.reset") ?? "Reset"}
            <X />
          </UiButton>
        )}
      </div>
    ) : undefined;

  const collapsesFacetsBehindButton = isNarrow && fillsHeight && facetCluster !== undefined;
  const hasToolbar =
    toolbarStart !== undefined ||
    toolbarDescription !== undefined ||
    toolbarEnd !== undefined ||
    facetCluster !== undefined;

  // dashboard-01-Muster: die Toolbar (Search + Facets + "+ Neu") sitzt ÜBER
  // der Tabelle im selben Padding-Block — kein separater bg-Bar, kein Screen-
  // Titel (der steht im Breadcrumb der Shell).
  return (
    // `screenPadding`: on a list screen this wrapper IS the screen container,
    // so it takes the same token as FormScreenShell/PageSection instead of its
    // own inset — a list ends at the same footer distance as a form (fw#2640).
    // Explicit `false` (vs. the default/omitted case) means a host that
    // already pads its own children — a relatedList section nested in a
    // tabs-mode Card (fw#3234 round 3) — so this wrapper adds no inset of its
    // own, or its content would sit ~24px deeper than sibling banners in the
    // same Card body.
    <div
      className={cn(
        "flex flex-col w-full",
        // scrollBody: the wrapper fills its container so the footer sits at the
        // same spot at 3 and 300 rows; the 24px insets live in toolbar, cells
        // and footer, so no outer padding.
        fillsHeight
          ? "h-full min-h-0"
          : cn(
              "gap-4",
              screenPadding === true
                ? screenPaddingClassName
                : screenPadding === false
                  ? undefined
                  : "p-6",
            ),
      )}
    >
      {hasToolbar && (
        <div
          data-testid={testId !== undefined ? `${testId}-toolbar` : "render-list-toolbar"}
          className={cn(
            "flex flex-wrap items-center",
            fillsHeight
              ? isNarrow
                ? "shrink-0 gap-2 p-3"
                : "min-h-13 shrink-0 gap-2 px-6 py-2 md:py-0"
              : "gap-3",
          )}
        >
          {/* min-w-48: without a floor, flex shrinks the search instead of wrapping the facet cluster onto its own line (fw#3116). */}
          {toolbarStart !== undefined && (
            <div
              className={cn(
                fillsHeight
                  ? "relative w-full md:w-[300px] max-md:flex-1 [&_input]:border-border-strong [&_input]:pl-8 [&_input]:max-md:h-11 md:[&_input]:h-8"
                  : "flex-1 min-w-48 max-w-sm",
              )}
            >
              {fillsHeight && (
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              {toolbarStart}
            </div>
          )}
          {toolbarDescription !== undefined && (
            <p
              data-testid={
                testId !== undefined ? `${testId}-description` : "render-list-description"
              }
              className="m-0 text-[13px] text-muted-foreground"
            >
              {toolbarDescription}
            </p>
          )}
          {collapsesFacetsBehindButton ? (
            <>
              <UiButton
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={tableTranslate?.("kumiko.list.filter.toggle") ?? "Filter"}
                aria-expanded={facetsOpenNarrow}
                data-testid={testId !== undefined ? `${testId}-filter-toggle` : "filter-toggle"}
                onClick={() => setFacetsOpenNarrow((open) => !open)}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
              </UiButton>
              {facetsOpenNarrow && <div className="w-full">{facetCluster}</div>}
            </>
          ) : (
            facetCluster
          )}
          {toolbarEnd !== undefined && (
            <div className="flex flex-wrap items-center gap-2 ml-auto">{toolbarEnd}</div>
          )}
        </div>
      )}
      {content}
    </div>
  );
}

// The primary row action is the one that always stays a visible text
// button — `edit` if declared, else the first visible action (fw
// bedienkonzept L3: "Bearbeiten steht in jeder Zeile, immer, als Text").
function primaryRowAction(actions: readonly DataTableRowAction[]): DataTableRowAction | undefined {
  return actions.find((a) => a.id === "edit") ?? actions[0];
}

// RowActionsCell renders the row actions depending on `mode`:
//   - "adaptive" (default): when the row itself is the link (`rowIsLink`)
//     every action sits in the kebab; otherwise the primary action (see
//     `primaryRowAction`) is a link-button and the rest goes into the kebab.
//     A single action never gets a kebab.
//   - "inline": ALWAYS inline buttons, left-aligned + full-width, even for
//     >2 (no kebab). `w-full justify-start` pins the first button to the
//     column's left edge so it sits at the same position across rows
//     (otherwise it would drift with differently-sized labels).
// The isVisible filter runs here; an action hidden for a given row never
// reaches render. If every action is hidden, the cell stays empty (no
// phantom column).
function RowActionsCell({
  row,
  actions,
  mode = "adaptive",
  rowIsLink = false,
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
  readonly mode?: DataTableRowActionMode;
  readonly rowIsLink?: boolean;
}): ReactNode {
  const visible = actions.filter((a) => a.isVisible === undefined || a.isVisible(row));
  if (visible.length === 0) return null;
  const hasExplicitDisplay = visible.some((a) => a.display !== undefined);
  if (mode === "inline") {
    // Teil C: >2 actions all carrying an icon collapse to icon-only —
    // otherwise "inline" is exactly the wall-to-wall text-button problem
    // this feature exists to fix. An author-set `display` takes that choice over.
    const iconOnly = !hasExplicitDisplay && shouldRenderActionsIconOnly(visible);
    return (
      <div className="flex w-full items-center gap-1 justify-start">
        {visible.map((a) => (
          <RowActionButton key={a.id} row={row} action={a} iconOnly={iconOnly} />
        ))}
      </div>
    );
  }
  if (hasExplicitDisplay) {
    const inline = visible.filter((a) => a.display !== undefined);
    const rest = visible.filter((a) => a.display === undefined);
    return (
      <div className="inline-flex items-center gap-1 justify-end">
        {inline.map((a) => (
          <RowActionButton key={a.id} row={row} action={a} />
        ))}
        {rest.length > 0 && <RowActionsKebab row={row} actions={rest} />}
      </div>
    );
  }
  if (rowIsLink) {
    return (
      <div className="inline-flex items-center justify-end">
        <RowActionsKebab row={row} actions={visible} />
      </div>
    );
  }
  const primary = primaryRowAction(visible);
  const rest = visible.filter((a) => a.id !== primary?.id);
  return (
    <div className="inline-flex items-center gap-1 justify-end">
      {primary !== undefined && <RowActionButton row={row} action={primary} asLink />}
      {rest.length > 0 && <RowActionsKebab row={row} actions={rest} />}
    </div>
  );
}

function isEmptyCellValue(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  );
}

// A boolean false renders as an empty string unless the column's format spec names a falseLabel.
function isUnlabeledFalse(type: string, value: unknown, renderer: unknown): boolean {
  if (type !== "boolean" || value !== false) return false;
  if (renderer === undefined) return true;
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    !("falseLabel" in renderer)
  );
}

// True when the cell would render the default "✓": no renderer, or a boolean
// format spec that names no trueLabel of its own.
function showsBareCheckMark(type: string, value: unknown, renderer: unknown): boolean {
  if (type !== "boolean" || value !== true) return false;
  if (renderer === undefined) return true;
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    !("trueLabel" in renderer)
  );
}

// Badges (select pills, component renderers) must never be clipped by the card's meta truncation.
function isBadgeColumn(col: { readonly type: string; readonly renderer?: unknown }): boolean {
  return col.type === "select" || isComponentRendererRef(col.renderer) !== undefined;
}

// The first cell is the keyboard-reachable entry point of a clickable row; the
// row's own onClick keeps serving the mouse. Enter is handled explicitly so
// it also opens the row where a button does not synthesize a click.
function FirstCellLink({
  enabled,
  empty,
  emptyLabel,
  onOpen,
  children,
}: {
  readonly enabled: boolean;
  readonly empty: boolean;
  // Names the link when the cell has no text, so a row whose rowClick action
  // is no longer in the kebab stays keyboard-reachable.
  readonly emptyLabel?: string | undefined;
  readonly onOpen: () => void;
  readonly children: ReactNode;
}): ReactNode {
  if (!enabled || (empty && emptyLabel === undefined)) return children;
  return (
    <button
      type="button"
      className="max-w-full cursor-pointer truncate bg-transparent p-0 text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
    >
      {empty ? <span className="sr-only">{emptyLabel}</span> : children}
    </button>
  );
}

// Shared trigger-State zwischen Inline-Button + Kebab-Item: busy-Flag
// (während async onTrigger läuft) + confirm-pending-Action. Beide Sub-
// Components hatten denselben State-Block dupliziert + parallel zur
// Confirm-Dialog-Render-Logic — der Hook konsolidiert das.
//
// The rule: an explicit confirm OR style=danger opens the dialog,
// everything else fires straight through.
// `confirmRequired` overrides the danger-implies-confirm default (e.g.
// schema-driven navigate/drawer actions where the target form is itself
// the confirmation).
function needsConfirm(action: DataTableRowAction): boolean {
  return action.confirm !== undefined || (action.confirmRequired ?? action.style === "danger");
}

function useRowActionTrigger(row: ListRowViewModel) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const t = useTranslation();
  const triggerNow = async (action: DataTableRowAction): Promise<void> => {
    setBusy(true);
    try {
      await action.onTrigger(row);
    } catch (e) {
      // Surfacing statt schlucken: ein verschluckter Write-Fehler sah für
      // den User wie "nichts passiert" aus (Prod-Bug 2026-06-07).
      const docsUrl = e instanceof WriteFailedError ? e.dispatcherError.docsUrl : undefined;
      toast({
        title: t("kumiko.rowAction.failed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "bad",
        ...(docsUrl !== undefined && { docsUrl }),
      });
    } finally {
      setBusy(false);
    }
  };
  return { busy, triggerNow };
}

function RowActionButton({
  row,
  action,
  iconOnly = false,
  asLink = false,
}: {
  readonly row: ListRowViewModel;
  readonly action: DataTableRowAction;
  readonly asLink?: boolean;
  /** Group-level collapse (see `shouldRenderActionsIconOnly`) — only takes
   *  effect when this action actually resolved an icon. */
  readonly iconOnly?: boolean;
}): ReactNode {
  const { busy, triggerNow } = useRowActionTrigger(row);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const resolvedIcon = actionIconFor(action.icon);
  // "icon" without a resolvable icon would render an empty button.
  const display = action.display === "icon" && resolvedIcon === undefined ? "link" : action.display;
  const isBorderedButton = display === "button";
  const showIconOnly =
    display === "icon" || (display === undefined && iconOnly && resolvedIcon !== undefined);
  const linkLike = display === "link" || (display === undefined && asLink);

  const variantClass = isBorderedButton
    ? action.style === "primary"
      ? "border border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
      : action.style === "danger"
        ? "border border-destructive/40 bg-card text-destructive hover:bg-destructive/10"
        : "border border-border-strong bg-card text-foreground hover:bg-accent"
    : action.style === "danger"
      ? "text-destructive hover:bg-destructive/10"
      : linkLike
        ? "font-medium text-primary hover:bg-muted"
        : action.style === "primary"
          ? "text-primary hover:bg-primary/10"
          : "text-foreground hover:bg-accent";

  return (
    <>
      <button
        type="button"
        data-testid={`row-${row.id}-action-${action.id}`}
        disabled={busy}
        {...(showIconOnly && { "aria-label": action.label, title: action.label })}
        onClick={(e) => {
          e.stopPropagation();
          if (needsConfirm(action)) {
            setConfirmOpen(true);
          } else {
            void triggerNow(action);
          }
        }}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 text-sm",
          isBorderedButton
            ? "h-8 rounded-md px-3 font-medium max-md:h-11"
            : linkLike
              ? "h-7 rounded-md px-2.5 max-md:h-11"
              : "h-8 rounded-sm",
          showIconOnly ? "w-8" : !linkLike && !isBorderedButton && "px-2",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClass,
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : resolvedIcon === undefined || (linkLike && !showIconOnly) ? (
          action.label
        ) : showIconOnly ? (
          <Icon name={resolvedIcon} className="size-4" />
        ) : (
          <>
            <Icon name={resolvedIcon} className="size-4" />
            {action.label}
          </>
        )}
      </button>
      <DefaultDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action.label}
        {...(action.confirm !== undefined && { description: action.confirm })}
        confirmLabel={action.confirmLabel ?? action.label}
        {...(action.style === "danger" && { variant: "danger" as const })}
        onConfirm={() => triggerNow(action)}
        testId={`row-${row.id}-action-${action.id}-dialog`}
      />
    </>
  );
}

// Kebab dropdown for >2 actions, one inline confirm dialog per item like
// the inline-button path. Menu is controlled so it closes explicitly on
// select, instead of relying on Radix's auto-close, which preventDefault
// below blocks.
function RowActionsKebab({
  row,
  actions,
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
}): ReactNode {
  const { triggerNow } = useRowActionTrigger(row);
  const t = useTranslation();
  const [pendingConfirm, setPendingConfirm] = useState<DataTableRowAction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("kumiko.list.row-actions.more")}
            data-testid={`row-${row.id}-actions-menu`}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md max-md:size-11",
              "hover:bg-accent text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              data-testid={`row-${row.id}-action-${action.id}`}
              onSelect={(e) => {
                e.preventDefault();
                setMenuOpen(false);
                if (needsConfirm(action)) {
                  setPendingConfirm(action);
                } else {
                  void triggerNow(action);
                }
              }}
              className={cn(action.style === "danger" && "text-destructive focus:text-destructive")}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {pendingConfirm !== null && (
        <DefaultDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setPendingConfirm(null);
          }}
          title={pendingConfirm.label}
          {...(pendingConfirm.confirm !== undefined && { description: pendingConfirm.confirm })}
          confirmLabel={pendingConfirm.label}
          {...(pendingConfirm.style === "danger" && { variant: "danger" as const })}
          onConfirm={async () => {
            const action = pendingConfirm;
            setPendingConfirm(null);
            await triggerNow(action);
          }}
          testId={`row-${row.id}-action-${pendingConfirm.id}-dialog`}
        />
      )}
    </>
  );
}

// Header/row-actions overflow menu (A7): the trigger carries the classes of a
// secondary icon Button so it matches neighbouring icon buttons, including
// the 44 px touch size on phones. Generic ActionMenuItemSpec items instead of
// the DataTableRowAction schema (callers own confirm/danger handling per item).
function ActionOverflowMenu({ items, label, testId }: ActionOverflowMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <UiButton
          type="button"
          variant="outline"
          size="icon"
          className="border-input hover:bg-muted"
          aria-label={label}
          data-testid={testId ?? "action-overflow-menu-trigger"}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </UiButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item: ActionMenuItemSpec) => {
          const resolvedIcon = actionIconFor(item.icon);
          return (
            <DropdownMenuItem
              key={item.id}
              data-testid={item.testId ?? `${testId ?? "action-overflow-menu"}-item-${item.id}`}
              disabled={item.disabled === true}
              onSelect={(e) => {
                e.preventDefault();
                setOpen(false);
                item.onSelect();
              }}
              className={cn(item.variant === "danger" && "text-destructive focus:text-destructive")}
            >
              {resolvedIcon !== undefined && <Icon name={resolvedIcon} className="size-4" />}
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// InfiniteSentinel — empty div at the end of the table that uses
// IntersectionObserver to detect when the user scrolls near the list end.
// onReachEnd fires exactly once per "becomes visible" transition; the
// caller debounces via loadingMore (further visibility events are ignored
// while a page is loading). No observer during server-side render, no
// observer when hasMore=false — then the sentinel only shows the
// end-of-list hint via t("kumiko.list.end-of-list"), which requires a
// LocaleProvider in the tree (same requirement as Field/useRowActionTrigger).
// Without one, useTranslation() throws; with one that's missing the framework
// defaults (fallbackBundles not including kumikoDefaultTranslations), the
// user sees the raw key instead of translated text.
// ponytail: threshold mirrors the framework default pageSize (kumiko-screen.tsx
// `screen.pageSize ?? 50`) rather than the real per-screen pageSize, which isn't
// threaded down to this component. A screen with a custom pageSize can still
// under- or over-show the marker; thread pageSize through KumikoScreen →
// RenderList → DataTable → InfiniteSentinel if that's needed (fw#1713).
export const END_LABEL_MIN_ROWS = 50;

function InfiniteSentinel({
  onReachEnd,
  loadingMore,
  hasMore,
  rowsCount,
  testId,
}: {
  readonly onReachEnd: () => void;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly rowsCount: number;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    if (loadingMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Nur das erste sichtbar-Event pro Mount auslösen — wenn der
        // User weiter scrollt während noch geladen wird, hindert
        // loadingMore=true den useEffect dass er den Observer überhaupt
        // erst remountet.
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onReachEnd();
            break;
          }
        }
      },
      { rootMargin: "200px" }, // pre-fetch wenn der Sentinel 200px vom Viewport ist
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReachEnd, loadingMore, hasMore]);

  const showEndLabel = !hasMore && rowsCount >= END_LABEL_MIN_ROWS;

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={cn(
        "flex items-center justify-center text-sm text-muted-foreground",
        showEndLabel || loadingMore ? "py-4" : "",
      )}
    >
      {showEndLabel ? (
        <span data-testid={testId !== undefined ? `${testId}-end` : undefined}>
          {t("kumiko.list.end-of-list")}
        </span>
      ) : loadingMore ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : hasMore ? (
        // Unsichtbar-Spacer solange noch geladen werden kann — der
        // Observer braucht ein DOM-Node, der User soll aber nichts sehen.
        <span aria-hidden="true">&nbsp;</span>
      ) : null}
    </div>
  );
}

// Pager — status text on the left ("X – Y of Z"), "Page X of Y" and the
// prev/next arrows on the right. No numbered page list: the board shows none.
// `pinned` renders the footer bar of a scrollBody table (fixed height, top
// border); unpinned it sits as a plain row below the table.
//
// Status text and aria-labels go through t(...), which requires a
// LocaleProvider in the tree — same requirement as InfiniteSentinel above,
// already established for DataTable consumers.
function Pager({
  page,
  limit,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  itemNoun,
  testId,
  pinned,
}: {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly onPageChange: (next: number) => void;
  readonly pageSizeOptions?: readonly number[];
  readonly onPageSizeChange?: (next: number) => void;
  readonly itemNoun?: (count: number) => string;
  readonly testId?: string;
  readonly pinned?: boolean;
}): ReactNode {
  const t = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const from = (safePage - 1) * limit + 1;
  const to = Math.min(safePage * limit, total);

  return (
    <div
      data-testid={testId}
      className={
        pinned === true
          ? TABLE_FOOTER_BAR_CLASS
          : "mt-3 flex items-center gap-4 text-[13px] tabular-nums text-foreground-secondary"
      }
    >
      <div data-testid={testId !== undefined ? `${testId}-status` : undefined} className="flex-1">
        {itemNoun !== undefined
          ? t("kumiko.pager.status.noun", {
              from: from.toLocaleString(),
              to: to.toLocaleString(),
              total: total.toLocaleString(),
              noun: itemNoun(total),
            })
          : t("kumiko.pager.status", {
              from: from.toLocaleString(),
              to: to.toLocaleString(),
              total: total.toLocaleString(),
            })}
      </div>
      {pageSizeOptions !== undefined && onPageSizeChange !== undefined && (
        <div className="relative hidden md:block">
          <select
            aria-label={t("kumiko.pager.pageSizeLabel")}
            data-testid={testId !== undefined ? `${testId}-page-size` : undefined}
            value={limit}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 appearance-none rounded-md border border-input bg-card pl-2 pr-7 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {t("kumiko.pager.pageSize", { size: size.toLocaleString() })}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50"
            aria-hidden="true"
          />
        </div>
      )}
      <div className="hidden md:block">
        {t("kumiko.pager.pageOf", {
          page: safePage.toLocaleString(),
          pages: totalPages.toLocaleString(),
        })}
      </div>
      <div className="flex items-center gap-2">
        <PagerButton
          ariaLabel={t("kumiko.pager.previousPage")}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          testId={testId !== undefined ? `${testId}-prev` : undefined}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </PagerButton>
        <PagerButton
          ariaLabel={t("kumiko.pager.nextPage")}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          testId={testId !== undefined ? `${testId}-next` : undefined}
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  onClick,
  ariaLabel,
  disabled,
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-md border border-border md:size-7",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:text-foreground-disabled",
      )}
    >
      {children}
    </button>
  );
}

// SortableHeader — rendert pro Spalte den th-Header, mit oder ohne
// Click-Sort. Drei Pfade:
//   (a) sortable=false ODER kein onSortChange → plain Label, keine
//       Cursor-Interaktion (DataTable rein als View ohne Sort-Wiring).
//   (b) sortable=true + onSortChange → Header ist ein Button, klick
//       cycled asc → desc → null. aria-sort spiegelt den State.
//   (c) sortable=true im Schema, aber keine onSortChange-Prop → still
//       label-only, aber data-sortable=true bleibt damit Tests die
//       Schema-Sicht kennen.
function SortableHeader({
  field,
  label,
  sortable,
  highlighted,
  numeric,
  sort,
  onSortChange,
}: {
  readonly field: string;
  readonly label: string;
  readonly sortable: boolean;
  readonly highlighted?: boolean;
  readonly numeric?: boolean;
  readonly sort?: DataTableSort;
  readonly onSortChange?: (next: DataTableSort | null) => void;
}): ReactNode {
  const active = sort?.field === field ? sort : undefined;
  const ariaSort: "ascending" | "descending" | "none" =
    active?.dir === "asc" ? "ascending" : active?.dir === "desc" ? "descending" : "none";

  if (!sortable || onSortChange === undefined) {
    return (
      <TableHead
        data-testid={`column-${field}`}
        data-sortable={sortable === true ? true : undefined}
        data-highlighted={highlighted === true ? "true" : undefined}
        className={cn(
          "font-medium text-muted-foreground",
          numeric === true && "text-right",
          highlighted === true && "bg-accent/40",
        )}
      >
        {label}
      </TableHead>
    );
  }

  const Icon = active?.dir === "asc" ? ArrowUp : active?.dir === "desc" ? ArrowDown : ArrowUpDown;
  const next = nextSortState(active?.dir, field);

  return (
    <TableHead
      data-testid={`column-${field}`}
      data-sortable="true"
      data-highlighted={highlighted === true ? "true" : undefined}
      aria-sort={ariaSort}
      className={cn(
        active !== undefined
          ? "font-semibold text-foreground"
          : "font-medium text-muted-foreground",
        numeric === true && "text-right",
        highlighted === true && "bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={() => onSortChange(next)}
        className={cn(
          "group/sort inline-flex h-8 items-center gap-1.5 rounded-sm px-2 -mx-2 text-sm [font-weight:inherit]",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active !== undefined && "text-foreground",
        )}
      >
        <span>{label}</span>
        <Icon
          data-sort-icon={active === undefined ? "idle" : "active"}
          className={cn(
            "size-3.5",
            active === undefined &&
              "opacity-0 group-hover/sort:opacity-40 group-focus-visible/sort:opacity-40",
          )}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  );
}

// 3-State-Toggle: kein Sort → asc → desc → kein Sort. Idiomatisch für
// Power-User-Listen wo "ich will die Server-Default-Order zurück" eine
// echte Aktion ist (statt unendlich asc↔desc zu togglen).
function nextSortState(current: DataTableSortDir | undefined, field: string): DataTableSort | null {
  if (current === undefined) return { field, dir: "asc" };
  if (current === "asc") return { field, dir: "desc" };
  return null;
}

// Type-guard für die `{ react: { __component: "Name" } }`-Form, in der
// PlatformComponent-Renderer im Schema serialisiert ankommen. Schemas
// reisen über die Wire (Server → Client), echte Component-Refs würden
// das brechen — der String-Key ist die SSoT.
export function isComponentRendererRef(renderer: unknown): { readonly name: string } | undefined {
  if (renderer === null || typeof renderer !== "object") return undefined;
  const reactBranch = (renderer as { react?: unknown }).react;
  if (reactBranch === null || typeof reactBranch !== "object") return undefined;
  const component = (reactBranch as { __component?: unknown }).__component;
  if (typeof component !== "string" || component.length === 0) return undefined;
  return { name: component };
}

// applyFormatSpec re-exported from headless (platform-agnostic).
export { applyFormatSpec };

type MoneyCellValue = {
  amount: number;
  currency: string;
  /** Exact integer cents from rehydrateMoney (fw#1830); preferred for display. */
  amountMinor?: number;
};

function isMoneyValue(value: unknown): value is MoneyCellValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["amount"] === "number" &&
    typeof (value as Record<string, unknown>)["currency"] === "string" &&
    /^[A-Za-z]{3}$/.test((value as Record<string, unknown>)["currency"] as string)
  );
}

// Type-spezifische Default-Cell-Renderer. Author kann pro Spalte einen
// expliziten renderer setzen (FormatSpec oder PlatformComponent); ohne
// expliziten renderer fällt DataTableCell hier durch.
//
//   - boolean → ✓ / leer
//   - timestamp/date → locale-formatiert (kein roher ISO-String)
//   - number/decimal/bigInt → locale-formatted via Intl.NumberFormat (fw#2160)
//   - select/multiSelect → human-readable (kebab-case → Title Case), multiSelect values joined with ", "
//   - money → { amount, currency } formatted via Intl (not "[object Object]")
//   - text/else → toString

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const warnedTimestampColumns = new Set<string>();

// A raw ISO string in a "text" column means the author forgot `renderer:
// { format: "timestamp" }` — guessing a format here could be wrong, so we
// warn and leave the value as-is instead of auto-formatting.
function warnMissingTimestampFormat(columnKey: string | undefined): void {
  if (typeof process === "undefined" || process.env.NODE_ENV === "production") return;
  const key = columnKey ?? "<unknown column>";
  if (warnedTimestampColumns.has(key)) return;
  warnedTimestampColumns.add(key);
  // biome-ignore lint/suspicious/noConsole: dev-only assertion
  console.warn(
    `[kumiko] column "${key}" renders a raw ISO timestamp as text — add renderer: { format: "timestamp" } to its column definition.`,
  );
}

export function defaultCellRender(
  value: unknown,
  type: string,
  optionLabels?: Readonly<Record<string, string>>,
  locale?: string,
  columnKey?: string,
  grouping = true,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value === true ? "✓" : "";
  if (type === "timestamp" || type === "date") {
    return applyFormatSpec({ format: type, locale }, value);
  }
  if (type === "number" || type === "decimal" || type === "bigInt") {
    return applyFormatSpec({ format: type, locale, grouping }, value);
  }
  if (type === "money") {
    if (!isMoneyValue(value)) return String(value);
    // formatMoney expects minor units scaled by currencyDecimals(currency).
    // rehydrateMoney's `amountMinor` is scaled by a flat MINOR_UNIT_SCALE=100
    // instead, which disagrees with currencyDecimals for non-2-decimal
    // currencies (JPY: 0 decimals → 100x too high; BHD: 3 decimals → 10x too
    // low). Deriving minor units from `amount` keeps this consistent with
    // render-field.tsx's moneyMinorValue.
    const minor = Math.round(value.amount * 10 ** currencyDecimals(value.currency));
    return formatMoney(minor, value.currency, locale);
  }
  if (type === "select" || type === "multiSelect") {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((v) => {
        const raw = String(v);
        // Translated label from the view-model builder (convention key
        // `<feature>:entity:<entity>:field:<field>:option:<value>`).
        // Fallback to humanizeSlug when no label is registered — same
        // behavior as before the optionLabels patch.
        const translated = optionLabels?.[raw];
        return translated !== undefined && translated !== raw ? translated : humanizeSlug(raw);
      })
      .join(", ");
  }
  if (type === "text" && typeof value === "string" && ISO_DATETIME_RE.test(value)) {
    warnMissingTimestampFormat(columnKey);
  }
  return typeof value === "string" ? value : String(value);
}

function humanizeSlug(slug: string): string {
  // "degraded-performance" → "Degraded performance". A dotted value such as
  // "mobile.de" is a domain, not a slug, and must stay as stored.
  if (slug.includes(".")) return slug;
  const spaced = slug.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Tooltip-Text für truncated Cells — bei Hover zeigt der Browser den
// vollen Text. Skipping für Object/Array (das ist nicht user-readable);
// Number/Boolean stringifyt der Browser ohnehin korrekt.
function cellTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

type DataTableCellProps = {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly field: string;
  readonly type: string;
  readonly renderer?: unknown;
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly optionTones?: Readonly<Partial<Record<string, SelectOptionTone>>>;
  readonly onChange?: (value: unknown) => void;
  readonly translate?: (key: string, params?: Readonly<Record<string, unknown>>) => string;
  readonly locale?: string;
  readonly grouping?: boolean;
};

const EMPTY_CELL_PLACEHOLDER = "–";

type TableItem =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly label: string;
      readonly collapsed: boolean;
    }
  | { readonly kind: "row"; readonly row: ListRowViewModel };

function buildTableItems(
  rows: readonly ListRowViewModel[],
  grouping: DataTableRowGrouping | undefined,
  toggledGroups: ReadonlySet<string>,
): readonly TableItem[] {
  if (grouping === undefined) return rows.map((row) => ({ kind: "row", row }));
  const groups = new Map<string, ListRowViewModel[]>();
  for (const row of rows) {
    const key = grouping.keyOf(row);
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [row]);
    else members.push(row);
  }
  return [...groups].flatMap(([key, members]): TableItem[] => {
    const collapsed = grouping.startsCollapsed(key) !== toggledGroups.has(key);
    return [
      { kind: "group", key, label: grouping.headerLabel(key, members), collapsed },
      ...(collapsed ? [] : members.map((row): TableItem => ({ kind: "row", row }))),
    ];
  });
}

const ROW_TONE_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "bg-status-bad/10 hover:bg-status-bad/15",
  warn: "bg-status-warn/10 hover:bg-status-warn/15",
  ok: "bg-status-ok/10 hover:bg-status-ok/15",
  neutral: "",
};

function rowToneClass(tone: SelectOptionTone | undefined): string {
  return tone === undefined ? "" : ROW_TONE_CLASS[tone];
}

const NUMERIC_COLUMN_TYPES: ReadonlySet<string> = new Set(["number", "decimal", "bigInt", "money"]);
// Digits stand in columns here, so they need equal-width figures; the body no longer sets tabular-nums.
const TABULAR_COLUMN_TYPES: ReadonlySet<string> = new Set([
  ...NUMERIC_COLUMN_TYPES,
  "date",
  "timestamp",
  "locatedTimestamp",
]);

// Cell-Renderer als Component (statt reiner Funktion) damit der
// useColumnRenderer-Hook aus dem Provider lesen kann. Die vier Pfade:
//   1. FormatSpec (`{ format: "timestamp" }` etc.) → applyFormatSpec.
//   2. RuntimeRenderer (Funktion) → direkter Aufruf. Nur für render-list-
//      interne Reference-Lookup-Closures — niemals aus dem serialisierten Schema.
//   3. PlatformComponent (`{ react: { __component: "X" } }`) → schaut
//      "X" über useColumnRenderer auf und rendert `<X value row column/>`.
//      Nicht registriert → einmalige Warnung + Default-Fallback.
//   4. Sonst → defaultCellRender (Type-basierter String-Renderer).
function DataTableCell({
  value,
  row,
  field,
  type,
  renderer,
  optionLabels,
  optionTones,
  onChange,
  translate,
  locale,
  grouping = true,
}: DataTableCellProps): ReactNode {
  const componentRef = isComponentRendererRef(renderer);
  const ResolvedComponent = useColumnRenderer(componentRef?.name);
  if (isEmptyCellValue(value) && typeof renderer !== "function" && componentRef === undefined) {
    return (
      <span data-empty-cell="true" className="text-muted-foreground">
        {EMPTY_CELL_PLACEHOLDER}
      </span>
    );
  }
  if (isUnlabeledFalse(type, value, renderer)) {
    return (
      <span data-empty-cell="true" className="text-muted-foreground">
        {EMPTY_CELL_PLACEHOLDER}
      </span>
    );
  }
  if (typeof renderer === "object" && renderer !== null && "format" in renderer) {
    return applyFormatSpec(
      { locale, ...(renderer as { format: string } & Record<string, unknown>) },
      value,
      translate,
    );
  }
  if (typeof renderer === "function") {
    const fn = renderer as (v: unknown, r?: Readonly<Record<string, unknown>>) => string;
    return fn(value, row);
  }
  if (componentRef !== undefined) {
    if (ResolvedComponent !== undefined) {
      const node = (
        <ResolvedComponent
          value={value}
          row={row}
          column={{ field }}
          {...(onChange !== undefined && { onChange })}
        />
      );
      // stopPropagation only on the editable branch — plain cells must still
      // fire row onClick when onCellChange is set for sibling editable cells.
      if (onChange !== undefined) {
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — not a control
          <span
            className="contents"
            onClick={(e: MouseEvent) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {node}
          </span>
        );
      }
      return node;
    }
    // Renderer im Schema referenziert, aber client-side kein Map-Eintrag —
    // typischer Fall: clientFeatures.columnRenderers vergessen oder
    // Tippfehler im __component-Key. Warnen statt crashen, damit ein
    // Schema-Boot trotzdem funktioniert (Default-Type-Renderer übernimmt).
    // biome-ignore lint/suspicious/noConsole: dev-warning für Schema-Konflikte
    console.warn(`[kumiko] columnRenderer "${componentRef.name}" not registered`);
  }
  // A select value renders as a pill instead of plain text. When the raw
  // value is a known status word, it carries the same tone as the
  // projectionDetail header badge — a status column stayed grey while the
  // detail view of the same value was coloured (fw#2579). Unknown values
  // keep the neutral outline pill.
  if (type === "select" && value !== null && value !== undefined && value !== "") {
    const label = defaultCellRender(value, type, optionLabels, locale);
    const declaredTone =
      typeof value === "string" && optionTones && Object.hasOwn(optionTones, value)
        ? optionTones[value]
        : undefined;
    const tone =
      declaredTone !== undefined
        ? statusToneForOptionTone(declaredTone)
        : typeof value === "string"
          ? statusToneForValue(value)
          : undefined;
    if (tone !== undefined) {
      return <StatusBadge tone={tone}>{label}</StatusBadge>;
    }
    // dashboard-01 pattern: outline badge + muted instead of a filled secondary.
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {label}
      </Badge>
    );
  }
  return defaultCellRender(value, type, optionLabels, locale, field, grouping);
}

// ---- Form + Section + Grid + Text ----

// Setzt DefaultSection in den Inner-Region-Modus: das ganze Form ist EINE
// Card, Sections sind divider-getrennte Abschnitte darin (shadcn-Muster wie
// Shipping/Invoice/Profile). Standalone (außerhalb Form) bleibt Section eine
// eigene Card.
const InsideFormContext = createContext(false);

// Eingebettete Forms (z.B. im AuthCard) tragen ihre Card-Fläche schon vom
// Container — der self-cardende DefaultForm würde sonst eine Card-in-Card
// erzeugen. BareFormProvider schaltet DefaultForm auf ein nacktes <form>
// (gestapelte Felder, kein eigener Rahmen/max-width).
const BareFormContext = createContext(false);

export function BareFormProvider({ children }: { children: ReactNode }): ReactNode {
  return <BareFormContext.Provider value={true}>{children}</BareFormContext.Provider>;
}

// App-wide default for FormScreenShell's width when a screen doesn't set its
// own `layout.width`. Default "4xl" keeps today's behavior for apps that
// don't opt into `createKumikoApp({ screenWidth })` (fw#2656).
const ScreenWidthContext = createContext<FormWidth>("4xl");

export function ScreenWidthProvider({
  width,
  children,
}: {
  readonly width: FormWidth;
  readonly children: ReactNode;
}): ReactNode {
  return <ScreenWidthContext.Provider value={width}>{children}</ScreenWidthContext.Provider>;
}

// Extension sections that render their own <form> via BareFormProvider
// (legacy custom-form pattern, e.g. ChangeEmailSection before fw#2703) land
// inside RenderEdit's host <form> (ExtensionSectionMount, render-edit.tsx) —
// nested <form> elements are invalid DOM, and real browsers can silently
// fall back to a native GET submit of the OUTER form, leaking field values
// into the URL (fw#2312, fw#2705). Degrading to a <div> when already inside
// a form avoids the nesting; the captured click still routes to THIS form's
// onSubmit instead of activating the real ancestor <form>.
function FormRoot({
  onSubmit,
  testId,
  className,
  children,
}: {
  readonly onSubmit: FormProps["onSubmit"];
  readonly testId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  if (useContext(InsideFormContext)) {
    return (
      <div
        onClickCapture={(e) => {
          // @cast-boundary dom-event-target: closest() needs an Element, and
          // click targets are always one in the browser/happy-dom.
          const submitButton = (e.target as HTMLElement).closest(
            "button[type=submit], button:not([type])",
          );
          if (submitButton === null) return;
          e.preventDefault();
          onSubmit();
        }}
        data-testid={testId}
        className={className}
      >
        {children}
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
      className={className}
    >
      {children}
    </form>
  );
}

// stickyActions alone pins the primary action with `position: fixed` on
// narrow viewports; together with fillHeight the flex chain pins the footer
// on every viewport instead.
function isPinnedFooter(
  stickyActions: boolean | undefined,
  fillHeight: boolean | undefined,
): boolean {
  return stickyActions === true && fillHeight === true;
}

// Sections wrapper for DefaultForm's card and chromeless layouts alike —
// only the card-derived padding on non-section children differs between
// them (see `chromeless` doc on FormProps).
function FormSections({
  children,
  chromeless,
  stickyActions,
  fillHeight,
  screenForm = false,
}: {
  readonly children: ReactNode;
  readonly chromeless: boolean;
  readonly stickyActions: boolean | undefined;
  readonly fillHeight: boolean | undefined;
  readonly screenForm?: boolean;
}): ReactNode {
  if (screenForm) {
    return (
      <div className="flex flex-col gap-9">
        <InsideFormContext.Provider value={true}>
          <ScreenFormContext.Provider value={true}>{children}</ScreenFormContext.Provider>
        </InsideFormContext.Provider>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col",
        // Section-Children (Auto-UI-Edit) trennt eine Linie ZWISCHEN
        // ihnen — sie padden sich selbst. Flache Felder (Custom-Screens)
        // kriegen Padding + Rhythmus, keine Linie zwischen jedem Feld.
        "[&>section:not(:first-child)]:border-t",
        // Margins, not padding: padding would land inside a child that has its own border/height.
        !chromeless && "[&>:not(section)]:mx-6 [&>:not(section)]:my-3",
        !chromeless && "[&>:not(section):first-child]:mt-6 [&>:not(section):last-child]:mb-6",
        // ponytail: fixed footer now pins only the primary action (single
        // button row + its own p-4, fw#2606) instead of the whole footer —
        // shrunk from pb-32 accordingly. Widen again if a wizard's primary
        // action ever wraps to two rows.
        stickyActions === true && fillHeight !== true && STICKY_FOOTER_SPACER_CLASS,
        // Same "no flex-1" reasoning as the card above: this is the
        // one section allowed to shrink (min-h-0) inside the card, not
        // one forced to grow past its content.
        fillHeight === true && "min-h-0",
        // The flex chain pins the footer, so the sections are the scroll surface.
        isPinnedFooter(stickyActions, fillHeight) && "flex-1 overflow-y-auto",
      )}
    >
      <InsideFormContext.Provider value={true}>{children}</InsideFormContext.Provider>
    </div>
  );
}

// Title/subtitle block shared by DefaultForm's card and chromeless layouts —
// RenderEdit already withholds screen.description from `subtitle` in tabs
// mode (chromeless), so whatever arrives here still renders, just without card chrome.
function FormTitleBlock({
  title,
  subtitle,
  titleAction,
  testId,
  bordered,
  fillHeight,
}: {
  readonly title: ReactNode;
  readonly subtitle: ReactNode;
  readonly titleAction: ReactNode;
  readonly testId: string | undefined;
  readonly bordered: boolean;
  readonly fillHeight: boolean | undefined;
}): ReactNode {
  if (title === undefined && subtitle === undefined && titleAction === undefined) return null;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        bordered ? cn(cardHeaderBorder, "px-6 pb-4 pt-5") : "pb-4",
        fillHeight === true && "shrink-0",
      )}
    >
      <div className="min-w-0">
        {title !== undefined && (
          <h2
            data-testid={testId !== undefined ? `${testId}-title` : undefined}
            className="text-lg font-semibold tracking-tight"
          >
            {title}
          </h2>
        )}
        {subtitle !== undefined && (
          <p
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className="mt-1 text-sm text-muted-foreground"
          >
            {subtitle}
          </p>
        )}
      </div>
      {titleAction !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-title-action` : undefined}
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
        >
          {titleAction}
        </div>
      )}
    </div>
  );
}

// `formActions` (render-edit.tsx) mixes a non-submit wizard Back button in
// with the submit-type Next/Finish button inside one Fragment — only the
// submit one is the "primary" action that fw#1918 needs pinned above a
// virtual keyboard. Back reads as `type="button"`, same as `secondaryActions`
// (Cancel/Delete/…), so it can safely join that group on mobile. A footer-slot
// mount can't expose `type="submit"` (its button is opaque app code), so it
// opts in via `STICKY_PRIMARY_ACTION_PROP` instead (`ScreenSlots.footerPrimary`).
function isPrimaryStickyAction(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { readonly type?: string } & StickyPrimaryActionMarker;
  return props.type === "submit" || props[STICKY_PRIMARY_ACTION_PROP] === true;
}

// `actions` from render-edit.tsx arrives as a single `<>…</>` Fragment
// element (not spread children) — Children.toArray only flattens fragments
// nested inside an already-flattened children list, not a Fragment passed
// as the whole value, so the Fragment's own children are unwrapped first.
function flattenActionNodes(node: ReactNode): readonly ReactNode[] {
  if (isValidElement(node) && node.type === Fragment) {
    return Children.toArray((node.props as { readonly children?: ReactNode }).children);
  }
  return Children.toArray(node);
}

// Footer wrapper for DefaultForm's card and chromeless layouts alike — only
// the card-derived horizontal padding/border differs between them.
function FormFooter({
  actions,
  secondaryActions,
  testId,
  chromeless,
  stickyActions,
  fillHeight,
  unsavedCount = 0,
  railed = false,
}: {
  readonly actions: ReactNode;
  readonly secondaryActions: ReactNode;
  readonly testId: string | undefined;
  readonly chromeless: boolean;
  readonly stickyActions: boolean | undefined;
  readonly fillHeight: boolean | undefined;
  readonly unsavedCount?: number;
  /** Footer sits under a step rail: symmetric px-6 instead of the form column's left inset. */
  readonly railed?: boolean;
}): ReactNode {
  const t = useTranslation();
  if (actions === undefined && secondaryActions === undefined) return null;
  // Only split when sticky: the non-sticky (regular, non-wizard) footer must
  // reproduce the previous DOM exactly (form-action-bar.test.tsx pins
  // `-actions`/`-actions-secondary` content 1:1 to the `actions`/
  // `secondaryActions` props).
  const actionNodes = stickyActions === true ? flattenActionNodes(actions) : undefined;
  const primaryActionNodes = actionNodes?.filter(isPrimaryStickyAction);
  const hasPrimaryAction = primaryActionNodes !== undefined && primaryActionNodes.length > 0;
  // No primary node found among `actions` (e.g. a wizard step with only
  // secondary buttons): fall back to pinning the whole, unpartitioned
  // `actions` node instead of splitting it — matches the pre-split fw#1918
  // behaviour where sticky footers always kept `actions` fixed.
  const nonPrimaryActionNodes = hasPrimaryAction
    ? actionNodes?.filter((node) => !isPrimaryStickyAction(node))
    : undefined;
  const renderedActions =
    stickyActions === true ? (hasPrimaryAction ? primaryActionNodes : actions) : actions;
  const hasNonPrimaryOverflow =
    nonPrimaryActionNodes !== undefined && nonPrimaryActionNodes.length > 0;
  const renderedSecondary =
    stickyActions === true && hasPrimaryAction ? (
      <>
        {secondaryActions}
        {nonPrimaryActionNodes}
      </>
    ) : (
      secondaryActions
    );
  const pinned = isPinnedFooter(stickyActions, fillHeight);
  return (
    <div
      className={cn(
        pinned
          ? cn(
              "flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-6",
              !railed && "md:pl-10",
            )
          : "flex flex-col-reverse gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4",
        !pinned && !chromeless && "px-[var(--card-padding)]",
        !pinned && !chromeless && cardFooterBorder,
        !pinned && fillHeight === true && "shrink-0",
      )}
    >
      {pinned && unsavedCount > 0 && (
        <div
          data-testid={testId !== undefined ? `${testId}-unsaved` : undefined}
          className="mr-auto flex items-center gap-2 text-[13px] text-foreground-secondary"
        >
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          {unsavedCount === 1
            ? t("kumiko.form.unsaved.one")
            : t("kumiko.form.unsaved.other", { count: unsavedCount })}
        </div>
      )}
      {(secondaryActions !== undefined || hasNonPrimaryOverflow) && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions-secondary` : undefined}
          className={cn(
            "flex flex-wrap items-center gap-2 max-sm:[&_button]:text-xs",
            pinned && hasNonPrimaryOverflow && "mr-auto",
          )}
        >
          {renderedSecondary}
        </div>
      )}
      {renderedActions !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions` : undefined}
          className={cn(
            "flex flex-wrap items-center gap-2",
            pinned
              ? "max-md:[&>button]:min-h-11"
              : "max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:min-h-11 sm:ml-auto",
            // Below sm (640px): pin only the primary action to the viewport
            // bottom instead of normal flow, so a virtual keyboard shrinking
            // the viewport can't push it out of reach (fw#1918). `fixed`
            // escapes the card's `overflow-hidden` (only transform/filter/
            // contain ancestors trap it, confirmed against
            // AppLayout/SidebarInset — neither sets those).
            stickyActions === true &&
              !pinned &&
              cn(
                "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:bg-background max-sm:p-4 max-sm:shadow-[0_-4px_12px_-4px_rgb(0_0_0_/_0.15)]",
                STICKY_FOOTER_SAFE_AREA_CLASS,
              ),
          )}
        >
          {renderedActions}
        </div>
      )}
    </div>
  );
}

const SECTION_NAV_MIN_ITEMS = 3;

// "On this page" navigation next to a screen form. The active entry follows
// the section nearest the top of the scroll surface; without IntersectionObserver
// (happy-dom, old engines) the first entry stays active until one is clicked.
function FormSectionNav({ items }: { readonly items: readonly FormSectionNavItem[] }): ReactNode {
  const t = useTranslation();
  const [activeId, setActiveId] = useState(items[0]?.id);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visibleIds = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visibleIds.add(entry.target.id);
          else visibleIds.delete(entry.target.id);
        }
        const firstVisible = items.find((item) => visibleIds.has(item.id));
        if (firstVisible !== undefined) setActiveId(firstVisible.id);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const item of items) {
      const target = document.getElementById(item.id);
      if (target !== null) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label={t("kumiko.form.on-this-page")}
      data-testid="form-section-nav"
      className="sticky top-0 hidden w-[200px] shrink-0 flex-col gap-0.5 self-start xl:flex"
    >
      <span className="pb-1.5 pl-3 text-xs text-muted-foreground">
        {t("kumiko.form.on-this-page")}
      </span>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`form-section-nav-${item.id}`}
            {...(active && { "aria-current": "true" as const })}
            onClick={() => {
              setActiveId(item.id);
              document
                .getElementById(item.id)
                ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
            }}
            className={cn(
              "border-l-2 px-3 py-[5px] text-left text-sm",
              active
                ? "border-primary font-semibold text-primary"
                : "border-border text-foreground-secondary hover:text-foreground",
            )}
          >
            {item.title}
          </button>
        );
      })}
    </nav>
  );
}

// Form inside the Drawer primitive: the drawer header carries the title, so
// only the description (as help text), the scrolling sections and a pinned
// footer remain. The scroll area is a sibling of the footer, never its parent.
function DrawerFormLayout({
  onSubmit,
  subtitle,
  actions,
  secondaryActions,
  summary,
  testId,
  children,
}: Pick<
  FormProps,
  "onSubmit" | "subtitle" | "actions" | "secondaryActions" | "testId" | "summary"
> & {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <FormRoot onSubmit={onSubmit} testId={testId} className="flex h-full min-h-0 w-full flex-col">
      <div
        data-testid={testId !== undefined ? `${testId}-scroll` : undefined}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
      >
        {summary !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-summary` : undefined}
            className="flex flex-col gap-0.5 rounded-lg bg-muted px-3.5 py-3"
          >
            <span className="text-sm font-semibold text-foreground">{summary.title}</span>
            {summary.subtitle !== undefined && (
              <span className="text-[13px] text-foreground-secondary">{summary.subtitle}</span>
            )}
          </div>
        )}
        {subtitle !== undefined && (
          <p
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className="text-[13px] text-foreground-secondary"
          >
            {subtitle}
          </p>
        )}
        <InsideFormContext.Provider value={true}>
          <ScreenFormContext.Provider value={true}>
            <InsideDrawerProvider value={false}>
              <DrawerBodyContext.Provider value={true}>
                <div className="flex flex-col gap-5">{children}</div>
              </DrawerBodyContext.Provider>
            </InsideDrawerProvider>
          </ScreenFormContext.Provider>
        </InsideFormContext.Provider>
      </div>
      {(actions !== undefined || secondaryActions !== undefined) && (
        <div
          data-testid={testId !== undefined ? `${testId}-footer` : undefined}
          className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-border px-6"
        >
          {secondaryActions}
          {actions}
        </div>
      )}
    </FormRoot>
  );
}

function DefaultForm({
  onSubmit,
  children,
  title,
  subtitle,
  actions,
  secondaryActions,
  testId,
  width,
  stickyActions,
  headerRegion,
  titleAction,
  fillHeight,
  chromeless,
  screenForm,
  unsavedCount,
  sectionNav,
  sideRail,
  summary,
}: FormProps): ReactNode {
  const insideDrawer = useInsideDrawer();
  // Eingebettet (AuthCard etc.): nacktes <form>, gestapelte Felder mit gap —
  // der Container trägt Card/Titel selbst, sonst Card-in-Card.
  if (useContext(BareFormContext)) {
    return (
      <FormRoot
        onSubmit={onSubmit}
        testId={testId}
        className={cn(
          "flex flex-col gap-4",
          // Bare forms stack sections without a card; without a divider a
          // section boundary reads as a layout gap, not structure.
          "[&>section:not(:first-child)]:border-t",
        )}
      >
        <InsideFormContext.Provider value={true}>{children}</InsideFormContext.Provider>
        {(secondaryActions !== undefined || actions !== undefined) && (
          <div className="flex items-center justify-end gap-2">
            {secondaryActions}
            {actions}
          </div>
        )}
      </FormRoot>
    );
  }

  if (insideDrawer) {
    return (
      <DrawerFormLayout
        onSubmit={onSubmit}
        subtitle={subtitle}
        actions={actions}
        secondaryActions={secondaryActions}
        summary={summary}
        testId={testId}
      >
        {children}
      </DrawerFormLayout>
    );
  }

  const isScreenForm = screenForm === true && fillHeight === true && chromeless !== true;
  const sections = (
    <FormSections
      chromeless={chromeless === true}
      stickyActions={stickyActions}
      fillHeight={fillHeight}
      screenForm={isScreenForm}
    >
      {children}
    </FormSections>
  );
  const footer = (
    <FormFooter
      actions={actions}
      secondaryActions={secondaryActions}
      testId={testId}
      chromeless={chromeless === true}
      stickyActions={stickyActions}
      fillHeight={fillHeight}
      {...(unsavedCount !== undefined && { unsavedCount })}
      railed={sideRail !== undefined}
    />
  );

  // Screen form: no card. A padded scroll surface holds the form column and,
  // from xl, the section navigation; the footer stays pinned below it.
  if (isScreenForm) {
    const showsSectionNav = sectionNav !== undefined && sectionNav.length >= SECTION_NAV_MIN_ITEMS;
    return (
      <FormRoot onSubmit={onSubmit} testId={testId} className="flex h-full min-h-0 w-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {sideRail}
          <div
            data-testid={testId !== undefined ? `${testId}-scroll` : undefined}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 md:px-10 md:pb-10 md:pt-7"
          >
            <div className="flex gap-18">
              <div
                className={cn(
                  "flex w-full min-w-0 flex-col gap-9",
                  width !== undefined ? screenWidthClassName[width] : "max-w-[640px]",
                )}
              >
                {headerRegion}
                <FormTitleBlock
                  title={title}
                  subtitle={subtitle}
                  titleAction={titleAction}
                  testId={testId}
                  bordered={false}
                  fillHeight={false}
                />
                {sections}
              </div>
              {showsSectionNav && <FormSectionNav items={sectionNav} />}
            </div>
          </div>
        </div>
        {footer}
      </FormRoot>
    );
  }

  // Pinned footer (fillHeight + stickyActions): the footer is a full-bleed
  // sibling BELOW the padded shell, so the shell's bottom inset does not float
  // it above the viewport edge; the shell shrinks (`flex-1`) to make room.
  const pinnedFooter = isPinnedFooter(stickyActions, fillHeight);
  const pinnedShellClassName = pinnedFooter ? "h-auto flex-1 pb-6" : undefined;

  // Tab content (bedienkonzept A1): the head card is the ONLY card on the
  // screen, so a tabbed projectionDetail's tab content must render as a
  // sibling of that card, not nest another one around itself — chromeless
  // skips the card wrapper and its border/padding so sections and footer
  // sit directly on the page background, same edge as a standalone list
  // screen. Title/subtitle still render unbordered: RenderEdit's tabs
  // caller already blanks the per-section title via hideSectionTitles, but
  // the screen-level subtitle (screen.description) is independent of that
  // and must survive tabs mode.
  if (chromeless === true) {
    return (
      <FormRoot
        onSubmit={onSubmit}
        testId={testId}
        className={cn("flex flex-col w-full", fillHeight === true && "h-full min-h-0")}
      >
        <FormScreenShell
          maxWidth="full"
          {...(fillHeight === true && { fillHeight: true })}
          className={cn("!p-0", pinnedShellClassName)}
        >
          {headerRegion !== undefined && (
            <div className={cn("flex flex-col", fillHeight === true && "shrink-0")}>
              {headerRegion}
            </div>
          )}
          <FormTitleBlock
            title={title}
            subtitle={subtitle}
            titleAction={titleAction}
            testId={testId}
            bordered={false}
            fillHeight={fillHeight}
          />
          {sections}
          {!pinnedFooter && footer}
        </FormScreenShell>
        {pinnedFooter && footer}
      </FormRoot>
    );
  }

  // One card form: title as header (no divider under it), sections divided
  // between each other, muted action footer. Shell width defaults to full
  // (same chrome as lists); pass width to narrow (auth-adjacent / dense).
  return (
    <FormRoot
      onSubmit={onSubmit}
      testId={testId}
      className={cn("flex flex-col w-full", fillHeight === true && "h-full min-h-0")}
    >
      <FormScreenShell
        {...(width !== undefined && { maxWidth: width })}
        {...(fillHeight === true && { fillHeight: true })}
        {...(pinnedShellClassName !== undefined && { className: pinnedShellClassName })}
      >
        {headerRegion !== undefined && (
          <div className={cn("flex flex-col gap-6 mb-8", fillHeight === true && "shrink-0")}>
            {headerRegion}
          </div>
        )}
        <div
          data-slot="card"
          className={cn(
            cardSurface(),
            "overflow-hidden",
            // No flex-1: a fillHeight card sizes to its content (flex's
            // initial 0 1 auto) and only claims more than that once its
            // FormScreenShell ancestor is itself height-constrained and
            // shrinks it back down via min-h-0 — flex-1 would instead force
            // it to always fill the remaining height, stretching a short
            // relatedList tab to the bottom of the panel (fw#2778).
            fillHeight === true && "min-h-0 flex flex-col",
            pinnedFooter && "flex-1",
          )}
        >
          <FormTitleBlock
            title={title}
            subtitle={subtitle}
            titleAction={titleAction}
            testId={testId}
            bordered={true}
            fillHeight={fillHeight}
          />
          {sections}
          {!pinnedFooter && footer}
        </div>
      </FormScreenShell>
      {pinnedFooter && footer}
    </FormRoot>
  );
}

// Canonical form/settings shell shared by DefaultForm (configEdit/entityEdit)
// and custom settings screens (profile, privacy-center). Width resolution:
// explicit `maxWidth` prop (screen's `layout.width`) wins, else the app-wide
// `createKumikoApp({ screenWidth })` default from ScreenWidthContext, else
// "4xl" (a centered column, narrower than list chrome, which runs full-width).
export type FormScreenShellWidth = FormWidth;

export function FormScreenShell({
  children,
  className,
  testId,
  maxWidth,
  fillHeight,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  readonly maxWidth?: FormScreenShellWidth;
  /** Stacks children in a `h-full` flex column instead of normal document
   *  flow, so a `flex-1 min-h-0` child can claim the remaining height below
   *  the others (fw#2722 — DefaultForm's tabs+relatedList case). Default
   *  false: unchanged, content-sized height. */
  readonly fillHeight?: boolean;
}): ReactNode {
  const contextWidth = useContext(ScreenWidthContext);
  const width = maxWidth ?? contextWidth;
  return (
    <div
      data-testid={testId}
      className={cn(
        screenPaddingClassName,
        "w-full",
        screenWidthClassName[width],
        fillHeight === true && "h-full flex flex-col min-h-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function DefaultSection({
  id,
  title,
  subtitle,
  children,
  actions,
  variant = "default",
  testId,
  icon,
}: SectionProps): ReactNode {
  const insideForm = useContext(InsideFormContext);
  const insideScreenForm = useContext(ScreenFormContext);

  // h3 statt CardTitle (= div): erhält die Heading-Semantik für
  // Screenreader-Navigation. Subtitle fließt darunter (kein Divider —
  // shadcn CardTitle+CardDescription-Muster).
  // icon only renders alongside a title — a title-less section has nothing
  // for a lone icon to sit next to, so it stays as-is (no heading grows).
  // actions render top-right in this same title row, never a
  // footer — a title-less section still draws the row when actions are
  // present, so a hideTitle tabs-Section with `actions` isn't stranded.
  const TitleTag = insideScreenForm ? "h2" : "h3";
  const titleBlock =
    title !== undefined || subtitle !== undefined ? (
      <div className="flex flex-col gap-1">
        {title !== undefined && (
          <TitleTag
            data-testid={testId !== undefined ? `${testId}-title` : undefined}
            className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight"
          >
            {icon !== undefined && <Icon name={icon} className="size-4 text-muted-foreground" />}
            {title}
          </TitleTag>
        )}
        {subtitle !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className={cn(
              "text-sm text-muted-foreground",
              insideScreenForm && "text-[13px] text-foreground-secondary",
            )}
          >
            {subtitle}
          </div>
        )}
      </div>
    ) : null;
  const header =
    titleBlock !== null || actions !== undefined ? (
      <div className="flex items-start justify-between gap-4">
        {titleBlock}
        {actions !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-actions` : undefined}
            className="ml-auto flex shrink-0 items-center gap-2"
          >
            {actions}
          </div>
        )}
      </div>
    ) : null;

  // Innerhalb eines Forms: divider-loser Abschnitt OHNE eigene Card-Fläche.
  // Die Trennlinien ZWISCHEN Sections macht der divide-y-Wrapper im Form.
  if (insideForm) {
    return (
      <section
        id={id}
        data-testid={testId}
        className={cn(
          // py-4 (not the standalone card's py-6): the border-t between
          // sections already carries the section break, so the vertical
          // gap only needs to read as roughly double the gap-4 field row
          // spacing, not triple it.
          insideScreenForm
            ? "flex scroll-mt-4 flex-col gap-4 [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:border-border [&:not(:first-of-type)]:pt-7"
            : "flex flex-col gap-4 px-6 py-4",
          variant === "destructive" && "border-l-2 border-destructive/40",
        )}
      >
        {header}
        {children}
      </section>
    );
  }

  // Standalone: own card, header flows into the body (no divider).
  // overflow-hidden clips the card's own corner radius correctly for
  // portaled overlays (Combobox/Select/Tooltip escape to document.body,
  // unaffected). A non-portaled overlay (e.g. a custom dropdown built
  // directly into `children`) WOULD get silently clipped — verify this
  // against any new standalone-section content that renders its own
  // non-portaled overlay.
  return (
    <div
      data-slot="card"
      data-testid={testId}
      className={cn(
        cardSurface(),
        "overflow-hidden",
        variant === "destructive" && "border-destructive/40",
      )}
    >
      <div className="flex flex-col gap-4 px-6 py-6">
        {header}
        {children}
      </div>
    </div>
  );
}

function DefaultFillContainer({ children, testId, grow }: FillContainerProps): ReactNode {
  // flex-1 only on request (`grow`, set under fillScreenHeight): without it the
  // container sizes to its content and only shrinks (min-h-0), so a two-row
  // table in a non-fixed-height screen does not stretch (fw#2778).
  return (
    <div data-testid={testId} className={cn("flex min-h-0 flex-col", grow === true && "flex-1")}>
      {children}
    </div>
  );
}

const DRAWER_FIELD_CELL_WIDTH_CLASS: Partial<Record<FieldCellWidth, string>> = {
  money: "w-full sm:w-[200px] [&_label]:whitespace-nowrap",
  select: "w-full",
};

const FIELD_CELL_WIDTH_CLASS: Readonly<Record<FieldCellWidth, string>> = {
  text: "w-full sm:w-60",
  number: "w-fit min-w-24 shrink-0 [&_label]:whitespace-nowrap [&_input]:w-32",
  money: "w-40 shrink-0 [&_label]:whitespace-nowrap",
  date: "w-full sm:w-[200px]",
  timestamp: "w-full sm:w-[328px]",
  select: "w-full sm:w-auto sm:min-w-[200px] sm:has-[[data-radio-list]]:w-full",
  full: "w-full",
  // self-start: the label shares the top line with neighbouring labels. The
  // switch (1.15rem) gets (h-9 input − switch) / 2 margin to sit on the input line.
  toggle: "w-auto min-w-40 shrink-0 self-start [&_[data-slot=switch]]:my-[0.55rem]",
};

function DefaultGrid({ columns, children, testId, maxRows, flow }: GridProps): ReactNode {
  const insideDrawerBody = useContext(DrawerBodyContext);
  if (flow === true) {
    return (
      <div
        data-testid={testId}
        className={cn(
          "flex gap-4",
          insideDrawerBody ? "flex-col items-start" : "flex-wrap items-end",
        )}
      >
        {children}
      </div>
    );
  }
  // "auto": content-sized items in a wrapping row (e.g. a metrics band of
  // self-sized tiles) instead of N equal-width, container-stretched tracks.
  // maxRows/scrolling don't apply — the row just wraps.
  if (columns === "auto") {
    return (
      <div data-testid={testId} className="flex flex-wrap items-center gap-4">
        {children}
      </div>
    );
  }
  // Responsive: Mobile (< sm = 640px) bleibt 1-spaltig, ab sm: greift
  // die Author-deklarierte Spaltenzahl. Inline-style schreibt
  // CSS-Variable; Tailwind-Klasse liest die Variable mit
  // `grid-template-columns: var(--grid-cols)`. Saubere Lösung weil
  // Tailwind JIT keinen dynamischen `grid-cols-${N}` auflösen kann.
  const rowCount = Math.ceil(Children.count(children) / columns);
  const clipped = maxRows !== undefined && rowCount > maxRows;
  // gridAutoRows is a minmax MIN, not a fixed height, so wrapped labels grow
  // their row instead of being clipped mid-row. maxHeight is therefore only
  // an approximation of "maxRows rows tall" — a row taller than the minimum
  // means fewer than maxRows rows end up visible before scrolling kicks in.
  // Themes may override --kumiko-grid-row-h (default 2.5rem, set in
  // styles.css) to change that minimum.
  // Mobile note: the grid collapses to 1 column below `sm` (see className),
  // but rowCount above is always computed against the desktop `columns` —
  // inline styles can't express a media query, so the mobile row count is
  // an under-count. Known, accepted.
  const style: CSSProperties = {
    "--grid-cols": `repeat(${columns}, minmax(0, 1fr))`,
    ...(clipped && {
      gridAutoRows: "minmax(var(--kumiko-grid-row-h, 2.5rem), auto)",
      maxHeight: `calc(${maxRows} * var(--kumiko-grid-row-h, 2.5rem) + ${maxRows - 1} * 1rem)`,
      overflowY: "auto",
    }),
    // workaround: duplicate @types/react instances break direct CSSProperties cast
  } as unknown as CSSProperties;
  return (
    <div
      data-testid={testId}
      className="grid gap-4 grid-cols-1 sm:[grid-template-columns:var(--grid-cols)]"
      style={style}
    >
      {children}
    </div>
  );
}

function DefaultGridCell({ span, width, children }: GridCellProps): ReactNode {
  const insideDrawerBody = useContext(DrawerBodyContext);
  if (width !== undefined) {
    return (
      <div
        className={cn(
          "min-w-0 max-w-full",
          insideDrawerBody
            ? (DRAWER_FIELD_CELL_WIDTH_CLASS[width] ?? FIELD_CELL_WIDTH_CLASS[width])
            : FIELD_CELL_WIDTH_CLASS[width],
        )}
      >
        {children}
      </div>
    );
  }
  const s = span !== undefined ? Math.min(span, 12) : 1;
  return <div style={{ gridColumn: `span ${s}` }}>{children}</div>;
}

function DefaultText({ variant = "body", decorative, children, testId }: TextProps): ReactNode {
  switch (variant) {
    case "code":
      return (
        <code
          data-testid={testId}
          className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm"
        >
          {children}
        </code>
      );
    case "small":
      return (
        <small data-testid={testId} className="text-xs text-muted-foreground">
          {children}
        </small>
      );
    case "required-mark":
      return (
        <span data-testid={testId} data-required className="text-destructive">
          {children}
        </span>
      );
    case "muted":
      return (
        <span
          data-testid={testId}
          {...(decorative === true && { "aria-hidden": true })}
          className="text-sm text-muted-foreground"
        >
          {children}
        </span>
      );
    default:
      return <span data-testid={testId}>{children}</span>;
  }
}

// ---- Link (anchor mit Button-/Muted-Optik) ----

// isSafeHref lives in @cosmicdrift/kumiko-headless — shared with
// page-render's server-side markdown renderer, both take untrusted
// tenant-authored hrefs.

// `button` nutzt die Primary-Buttonfläche auf einem semantischen <a> —
// der Standard für „weiter zu"-Navigationen nach Success-States (ehem.
// authButtonClass), `muted` der dezente Sekundär-Link (ehem.
// authMutedLinkClass).
function DefaultLink({
  href,
  variant = "default",
  target,
  rel,
  onPress,
  className,
  children,
  testId,
  dataAttributes,
}: LinkProps): ReactNode {
  const variantClass =
    variant === "button"
      ? buttonVariants({ variant: "default" })
      : variant === "muted"
        ? "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        : "text-primary underline-offset-4 hover:underline";
  return (
    <a
      href={isSafeHref(href) ? href : "#"}
      target={target}
      rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
      {...dataAttributes}
      data-testid={testId}
      className={cn(variantClass, className)}
      onClick={
        onPress === undefined
          ? undefined
          : (event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              onPress();
            }
      }
    >
      {children}
    </a>
  );
}

function DefaultProgress({ value, tone, ariaLabel, testId }: ProgressProps): ReactNode {
  return <ProgressBar value={value} tone={tone} ariaLabel={ariaLabel} testId={testId} />;
}

function DefaultStepBar({
  steps,
  currentIndex,
  compactLabel,
  onStepSelect,
  narrowLayout,
  orientation,
  heading,
  description,
  subtitles,
  upNext,
  testId,
  compactTestId,
}: StepBarProps): ReactNode {
  return (
    <StepBar
      steps={steps}
      currentIndex={currentIndex}
      compactLabel={compactLabel}
      onStepSelect={onStepSelect}
      narrowLayout={narrowLayout}
      orientation={orientation}
      heading={heading}
      description={description}
      subtitles={subtitles}
      upNext={upNext}
      testId={testId}
      compactTestId={compactTestId}
    />
  );
}

function DefaultWizardStepGroup({ hidden, inset, children }: WizardStepGroupProps): ReactNode {
  const visibleClass = inset === true ? "flex min-w-0 flex-col gap-4 p-6" : "contents";
  return (
    <fieldset disabled={hidden} hidden={hidden} className={hidden ? undefined : visibleClass}>
      {children}
    </fieldset>
  );
}

function DefaultHeading({ variant = "page", children, testId }: HeadingProps): ReactNode {
  // Page-Heading = h1, sehr selten in einer App (max 1 pro Screen).
  // Section-Heading = h2 mit uppercase + muted-foreground — derselbe
  // Look wie der Section-Header in Forms, aber als Standalone-Component
  // für Demo-Pages und Custom-Screens nutzbar.
  if (variant === "section") {
    return (
      <h2
        data-testid={testId}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {children}
      </h2>
    );
  }
  return (
    <h1 data-testid={testId} className="text-2xl font-semibold tracking-tight">
      {children}
    </h1>
  );
}

import { ConfigCascadeView as DefaultConfigCascadeView } from "../components/config-cascade.js";
import { ConfigSourceBadge as DefaultConfigSourceBadge } from "../components/config-source-badge.js";

// Generische Card-Chrome (rounded-xl wie die Entity-Card) — slot- + options-
// basiert, damit der Contract additiv wächst und Consumer nie migriert werden.
export function DefaultCard({
  slots,
  options,
  className,
  testId,
  dataAttributes,
  children,
}: CardProps): ReactNode {
  const padded = options?.padded ?? true;
  const radius = options?.radius ?? "xl";
  const footerBordered = options?.footerBordered ?? true;
  const fillHeight = options?.fillHeight ?? false;
  const framed = options?.framed ?? true;
  const s = slots ?? {};
  const defaultHeader =
    s.title !== undefined ||
    s.subtitle !== undefined ||
    s.headerContent !== undefined ||
    s.headerActions !== undefined ? (
      <div
        className={cn(
          "flex flex-col gap-3 px-[var(--card-padding)] pt-6 pb-4",
          fillHeight && "shrink-0",
        )}
      >
        {(s.title !== undefined || s.subtitle !== undefined || s.headerActions !== undefined) && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              {s.title !== undefined && (
                <h3 className="text-base font-semibold leading-none tracking-tight">{s.title}</h3>
              )}
              {s.subtitle !== undefined && (
                <p className="text-sm text-muted-foreground">{s.subtitle}</p>
              )}
            </div>
            {s.headerActions}
          </div>
        )}
        {/* Own full-width row: beside the actions, block content would end at
            a different right edge than the card body below it. */}
        {s.headerContent}
      </div>
    ) : null;
  const header = s.header ?? defaultHeader;
  const hasHeader = header !== null && header !== undefined;
  return (
    <div
      data-slot="card"
      {...dataAttributes}
      data-testid={testId}
      className={cn(
        framed ? cardSurface({ radius }) : "flex flex-col",
        "overflow-hidden",
        // Same "no flex-1" reasoning as DefaultForm's own fillHeight card
        // (fw#2722/#2778): sizes to content and only shrinks (min-h-0) once
        // an ancestor is itself height-constrained.
        fillHeight && "min-h-0 flex flex-col",
        className,
      )}
    >
      {header}
      {/* != null covers undefined AND explicit null; a `false` child (from
          `cond && <El/>`) still renders no visible content either way. */}
      {children != null && (
        <div
          className={cn(
            "grow",
            padded &&
              (hasHeader
                ? "px-[var(--card-padding)] pb-[var(--card-padding)]"
                : "p-[var(--card-padding)]"),
            // The one region allowed to shrink and scroll internally — mirrors
            // FormSections' fillHeight === true && "min-h-0" treatment of the
            // section it wraps.
            fillHeight && "min-h-0 flex flex-col",
          )}
        >
          {children}
        </div>
      )}
      {s.footer !== undefined && (
        <div
          className={cn(cardFooter, footerBordered && cardFooterBorder, fillHeight && "shrink-0")}
        >
          {s.footer}
        </div>
      )}
    </div>
  );
}

// otpauth:// enrollment URI → scannable QR (errorCorrectionLevel "H", ~30%
// redundancy — more resilient to camera/lighting issues than the default, no
// downside for a code this short-lived). Own component (not inline in
// values.map) because QRCode.toString is async — a hook inside .map would
// violate the rules of hooks.
function QrSecretValue({ value }: { readonly value: string }): ReactNode {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "H" })
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch(() => {
        // a reveal value always has the plaintext/manual-entry display alongside — QR is just convenience
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (svg === null) return null;
  return (
    <div
      className="h-40 w-40"
      // qrcode's own SVG string output, not user input — safe to inline
      // biome-ignore lint/security/noDangerouslySetInnerHtml: qrcode-generated SVG, no user input
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// One-time secret reveal (fw#2548, secretMint confirm phase) — monospaced
// per-value display with a copy button that flips to `copiedLabel` on
// success. Silent-catch on clipboard error mirrors the copy-link pattern in
// create-app.tsx.
function DefaultSecretReveal({
  values,
  copyLabel,
  copiedLabel,
  testId,
}: SecretRevealProps): ReactNode {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      {values.map((v, i) => (
        <div key={v.label} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{v.label}</span>
          <div className="flex items-start gap-2">
            {v.qr === true ? (
              <QrSecretValue value={v.value} />
            ) : v.multiline ? (
              <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                {v.value}
              </pre>
            ) : (
              <code className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                {v.value}
              </code>
            )}
            {v.copyable && (
              <UiButton
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(v.value);
                    setCopiedIndex(i);
                  } catch {
                    // clipboard blocked (non-secure context) — no fallback UI needed here
                  }
                }}
              >
                {copiedIndex === i ? copiedLabel : copyLabel}
              </UiButton>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export const defaultPrimitives: CorePrimitives = {
  Button: DefaultButton,
  Banner: DefaultBanner,
  Field: DefaultField,
  Input: DefaultInput,
  DataTable: DefaultDataTable,
  EmbeddedListInput,
  Form: DefaultForm,
  Section: DefaultSection,
  Card: DefaultCard,
  Grid: DefaultGrid,
  GridCell: DefaultGridCell,
  Text: DefaultText,
  Heading: DefaultHeading,
  Dialog: DefaultDialog,
  Modal: DefaultModal,
  Drawer: DefaultDrawer,
  Lightbox: DefaultLightbox,
  ConfigSourceBadge: DefaultConfigSourceBadge,
  ConfigCascadeView: DefaultConfigCascadeView,
  Link: DefaultLink,
  Progress: DefaultProgress,
  StepBar: DefaultStepBar,
  WizardStepGroup: DefaultWizardStepGroup,
  Tabs: DefaultTabs,
  StatusBadge: DefaultStatusBadge,
  Metric: DefaultMetric,
  MetricBand: DefaultMetricBand,
  PageHeader: DefaultPageHeader,
  JsonView: DefaultJsonView,
  FillContainer: DefaultFillContainer,
  ActionOverflowMenu,
  SecretReveal: DefaultSecretReveal,
  StickyActionBar,
  CopyButton,
  ShareButton,
  PromoPanel,
};
