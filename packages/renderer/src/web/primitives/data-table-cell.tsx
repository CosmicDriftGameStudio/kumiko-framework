import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-types/kms-adapter-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { Check } from "lucide-react";
import { Fragment, type MouseEvent, type ReactNode } from "react";
import { rendererWarn } from "../../dev-console.ts";
import { fileIdsOf } from "../../file-ids-of.ts";
import type {
  CellLink,
  CellLinkItem,
  ListColumnCellDisplay,
  ListColumnFileDisplay,
  ListColumnHintViewModel,
  ListRowViewModel,
  RuntimeCellLink,
  RuntimeCellLinkItems,
} from "../../headless/index.ts";
import {
  applyFormatSpec,
  EMPTY_VALUE_PLACEHOLDER,
  formatMoneyValue,
  isSafeHref,
  telHref,
} from "../../headless/index.ts";
import {
  type PrimitivesRegistry,
  statusToneForOptionTone,
  statusToneForValue,
  useColumnRenderer,
  useOptionalPrimitives,
} from "../../index.ts";
import { serverNowMs } from "../../server-clock.ts";
import { isSelectOptionTone } from "../../status-tone.ts";
import { Badge } from "../ui/badge.tsx";
import { buttonVariants } from "../ui/button.tsx";
import { StatusBadge, type StatusBadgeTone } from "../widgets/status-badge.tsx";
import { HintCell } from "./data-table/hint-cell.tsx";
import { FileDisplayCell } from "./file-thumbnail.tsx";
import { FileViewAction } from "./file-view-action.tsx";
import "../react-css-custom-properties.ts";
import { useOptionalTranslation } from "../../index.ts";
import { isPlainPrimaryClick } from "./layout-elements.tsx";

export function isEmptyCellValue(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  );
}

// A boolean false renders as an empty string unless the column's format spec names a falseLabel.
// Projection lists synthesize every column as type "text", so a boolean format spec
// marks a boolean column on its own.
function isBooleanColumn(type: string, renderer: unknown): boolean {
  if (type === "boolean") return true;
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    renderer.format === "boolean"
  );
}

export function isUnlabeledFalse(type: string, value: unknown, renderer: unknown): boolean {
  if (value !== false || !isBooleanColumn(type, renderer)) return false;
  if (renderer === undefined) return true;
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    renderer.format === "boolean" &&
    !("falseLabel" in renderer)
  );
}

function isUnlabeledBooleanFormat(renderer: unknown): boolean {
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    renderer.format === "boolean" &&
    !("trueLabel" in renderer) &&
    !("falseLabel" in renderer)
  );
}

function BooleanCell({
  value,
  translate,
}: {
  readonly value: boolean;
  readonly translate: DataTableCellProps["translate"];
}): ReactNode {
  const label = value
    ? (translate?.("kumiko.boolean.yes") ?? "Yes")
    : (translate?.("kumiko.boolean.no") ?? "No");
  return (
    <span data-boolean-cell={value ? "true" : "false"}>
      {value ? (
        <Check aria-hidden="true" className="h-4 w-4" />
      ) : (
        <span aria-hidden="true" className="text-muted-foreground">
          {EMPTY_VALUE_PLACEHOLDER}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

// True when the cell would render the default "✓": no renderer, or a boolean
// format spec that names no trueLabel of its own.
export function showsBareCheckMark(type: string, value: unknown, renderer: unknown): boolean {
  if (value !== true || !isBooleanColumn(type, renderer)) return false;
  if (renderer === undefined) return true;
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    !("trueLabel" in renderer)
  );
}

// Badges (select pills, component renderers) must never be clipped by the card's meta truncation.
export function isBadgeColumn(col: {
  readonly type: string;
  readonly renderer?: unknown;
}): boolean {
  return (
    col.type === "select" ||
    col.type === "multiSelect" ||
    isComponentRendererRef(col.renderer) !== undefined
  );
}

// The first cell is the keyboard-reachable entry point of a clickable row; the
// row's own onClick keeps serving the mouse. Enter is handled explicitly so
// it also opens the row where a button does not synthesize a click.
export function FirstCellLink({
  enabled,
  empty,
  emptyLabel,
  emptyPlaceholder,
  onOpen,
  children,
}: {
  readonly enabled: boolean;
  readonly empty: boolean;
  readonly emptyPlaceholder?: string | false | undefined;
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
      className="max-w-full cursor-pointer bg-transparent p-0 text-left font-medium text-inherit hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
      {empty ? (
        <>
          <span className="sr-only">{emptyLabel}</span>
          <EmptyCell placeholder={emptyPlaceholder} />
        </>
      ) : (
        children
      )}
    </button>
  );
}

// w-px on an auto-layout table cell shrinks the column to its content (the
// actions column relies on the same behaviour).
export const FIT_CONTENT_CELL_CLASS = "w-px";

// Type guard for the `{ react: { __component: "Name" } }` form in which
// PlatformComponent renderers arrive serialized in the schema. Schemas
// travel over the wire (server -> client), real component refs would break
// that; the string key is the single source of truth.
export function isComponentRendererRef(renderer: unknown): { readonly name: string } | undefined {
  if (renderer === null || typeof renderer !== "object") return undefined;
  const reactBranch = propertyOf(renderer, "react");
  if (reactBranch === null || typeof reactBranch !== "object") return undefined;
  const component = propertyOf(reactBranch, "__component");
  if (typeof component !== "string" || component.length === 0) return undefined;
  return { name: component };
}

type MoneyCellValue = {
  amount: number;
  currency: string;
  /** Exact integer cents from rehydrateMoney; preferred for display. */
  amountMinor?: number;
};

function isMoneyValue(value: unknown): value is MoneyCellValue {
  const currency = propertyOf(value, "currency");
  return (
    typeof value === "object" &&
    value !== null &&
    typeof propertyOf(value, "amount") === "number" &&
    typeof currency === "string" &&
    /^[A-Za-z]{3}$/.test(currency)
  );
}

// Type-specific default cell renderers. The author can set an explicit
// renderer per column (FormatSpec or PlatformComponent); without an
// explicit renderer DataTableCell falls through to here.
//
//   - boolean -> check mark / empty
//   - timestamp/date -> locale-formatted (no raw ISO string)
//   - number/decimal/bigInt → locale-formatted via Intl.NumberFormat
//   - select/multiSelect → human-readable (kebab-case → Title Case), multiSelect values joined with ", "
//   - money → { amount, currency } formatted via Intl (not "[object Object]")
//   - text/else -> toString

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

// Deduplicated per column key only (not per screen): a once-per-field-name
// hint, so a second screen reusing the same field name stays silent.
const warnedTimestampColumns = new Set<string>();

// A raw ISO string in a "text" column means the author forgot `renderer:
// { format: "timestamp" }` — guessing a format here could be wrong, so we
// warn and leave the value as-is instead of auto-formatting.
function warnMissingTimestampFormat(columnKey: string | undefined): void {
  if (typeof process === "undefined" || process.env.NODE_ENV === "production") return;
  const key = columnKey ?? "<unknown column>";
  if (warnedTimestampColumns.has(key)) return;
  warnedTimestampColumns.add(key);
  rendererWarn(
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
    return formatMoneyValue(value, locale);
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

// Tooltip text for truncated cells: on hover the browser shows the
// full text. Skipped for object/array (not user-readable);
// the browser stringifies numbers correctly anyway; booleans get no raw true/false tooltip.
export function cellTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function selectPill(
  value: unknown,
  optionLabels: Readonly<Record<string, string>> | undefined,
  optionTones: Readonly<Partial<Record<string, SelectOptionTone>>> | undefined,
  locale: string | undefined,
  RegisteredStatusBadge: PrimitivesRegistry["StatusBadge"],
): ReactNode {
  const label = defaultCellRender(value, "select", optionLabels, locale);
  const declaredTone =
    typeof value === "string" && optionTones && Object.hasOwn(optionTones, value)
      ? optionTones[value]
      : undefined;
  const tone =
    (declaredTone !== undefined ? statusToneForOptionTone(declaredTone) : undefined) ??
    (typeof value === "string" ? statusToneForValue(value) : undefined);
  if (tone !== undefined) {
    // Same registered primitive as the projectionDetail header, so an app-provided badge applies to list cells too.
    if (RegisteredStatusBadge !== undefined) {
      return <RegisteredStatusBadge value={label} tone={tone} />;
    }
    return <StatusBadge tone={tone}>{label}</StatusBadge>;
  }
  // dashboard-01 pattern: outline badge + muted instead of a filled secondary.
  return (
    <Badge variant="outline" className="px-1.5 text-muted-foreground">
      {label}
    </Badge>
  );
}

// enumOption's `tones` arrive with the untyped spec, so each entry is checked here.
function enumOptionTones(
  spec: Readonly<Record<string, unknown>>,
): Readonly<Partial<Record<string, SelectOptionTone>>> | undefined {
  const tones = spec["tones"];
  if (spec["format"] !== "enumOption" || typeof tones !== "object" || tones === null) {
    return undefined;
  }
  const out: Partial<Record<string, SelectOptionTone>> = {};
  for (const [option, tone] of Object.entries(tones)) {
    if (isSelectOptionTone(tone)) out[option] = tone;
  }
  return out;
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
  readonly fileDisplay?: ListColumnFileDisplay;
  readonly compactFile?: boolean;
  readonly link?: CellLink;
  readonly linkItems?: readonly CellLinkItem[];
  readonly hint?: ListColumnHintViewModel;
  readonly display?: ListColumnCellDisplay;
  readonly badgeToneField?: string;
  readonly badgeDot?: false;
  readonly pillField?: string;
  readonly pillToneField?: string;
  readonly emptyPlaceholder?: string | false;
  readonly dateOnlyAfterDays?: number;
  readonly onOpenRow?: () => void;
};

const MS_PER_DAY = 86_400_000;

function dateOnlyWhenOlderThan(
  value: unknown,
  days: number,
  locale: string | undefined,
  renderer: unknown,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const atMs = typeof value === "number" ? value : Date.parse(value);
  // An unparsable or out-of-range value falls back to the plain cell text.
  if (Number.isNaN(new Date(atMs).getTime())) return undefined;
  if (serverNowMs() - atMs <= days * MS_PER_DAY) return undefined;
  const timeZone =
    typeof renderer === "object" &&
    renderer !== null &&
    "timeZone" in renderer &&
    typeof renderer.timeZone === "string"
      ? renderer.timeZone
      : undefined;
  return applyFormatSpec(
    {
      format: "date",
      dateStyle: "long",
      ...(locale !== undefined && { locale }),
      ...(timeZone !== undefined && { timeZone }),
    },
    new Date(atMs).toISOString(),
  );
}

export function EmptyCell({
  placeholder,
}: {
  readonly placeholder: string | false | undefined;
}): ReactNode {
  const t = useOptionalTranslation();
  // translate returns an unknown key (a literal like "No vehicle") unchanged.
  const text = typeof placeholder === "string" ? (t?.(placeholder) ?? placeholder) : null;
  return (
    <span data-empty-cell="true" className="text-muted-foreground">
      {text}
    </span>
  );
}

/** `display: "button"` draws a cell link as a small outline button. */
export const LINK_BUTTON_CLASS = buttonVariants({ variant: "outline", size: "sm" });
export const LINK_BUTTON_PRIMARY_CLASS = buttonVariants({ variant: "default", size: "sm" });

/** Badge tones by the list-wide ListBadgeTone words. */
export const LIST_BADGE_TONE: Readonly<Record<string, StatusBadgeTone>> = {
  positive: "ok",
  warn: "warn",
  negative: "bad",
  neutral: "muted",
  ok: "ok",
  bad: "bad",
  critical: "bad",
  accent: "muted",
};

// A multi reference may list the same id twice; the occurrence count keeps React keys unique.
function uniqueLinkItemKeys(items: readonly CellLinkItem[]): readonly string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const occurrence = seen.get(item.id) ?? 0;
    seen.set(item.id, occurrence + 1);
    return `${item.id}#${occurrence}`;
  });
}

// A link nested in the clickable first-cell button or card button would be an
// <a> inside a <button>, so those cells stay plain text.
export function cellLinkProp(
  col: {
    readonly field: string;
    readonly linkFor?: RuntimeCellLink | undefined;
    readonly linkItemsFor?: RuntimeCellLinkItems | undefined;
  },
  row: ListRowViewModel,
  allowed: boolean,
): { readonly link?: CellLink; readonly linkItems?: readonly CellLinkItem[] } {
  if (!allowed) return {};
  const link = col.linkFor?.(row.values[col.field], row.values);
  const linkItems = col.linkItemsFor?.(row.values[col.field], row.values);
  return {
    ...(link !== undefined && { link }),
    ...(linkItems !== undefined && { linkItems }),
  };
}

// Tone is a left stripe, not a fill: a tinted row reads as selected or disabled and fights the
// opaque sticky actions cell. Rows draw it as an inset shadow on the first cell (a border on a
// <tr> collapses away), cards as a real border. The colour also lands in --row-stripe because a
// pinned cell sets its own inline box-shadow, which would otherwise replace the stripe.
const ROW_STRIPE_SHADOW_CLASS = "[&>td:first-child]:shadow-[inset_4px_0_0_var(--row-stripe)]";
const ROW_TONE_STRIPE_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: `${ROW_STRIPE_SHADOW_CLASS} [&>td:first-child]:[--row-stripe:var(--color-status-bad)]`,
  warn: `${ROW_STRIPE_SHADOW_CLASS} [&>td:first-child]:[--row-stripe:var(--color-status-warn)]`,
  ok: `${ROW_STRIPE_SHADOW_CLASS} [&>td:first-child]:[--row-stripe:var(--color-status-ok)]`,
  critical: `${ROW_STRIPE_SHADOW_CLASS} [&>td:first-child]:[--row-stripe:var(--color-status-critical)]`,
  accent: `${ROW_STRIPE_SHADOW_CLASS} [&>td:first-child]:[--row-stripe:var(--color-primary)]`,
  neutral: "",
};

// Inner 3px edge stripe (board .card.cw): sits inside the card border, rounded with the card corners.
const CARD_STRIPE_BASE =
  "relative pl-5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-[7px] before:content-['']";

const CARD_TONE_STRIPE_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: `${CARD_STRIPE_BASE} before:bg-status-bad`,
  warn: `${CARD_STRIPE_BASE} before:bg-status-warn`,
  ok: `${CARD_STRIPE_BASE} before:bg-status-ok`,
  critical: `${CARD_STRIPE_BASE} before:bg-status-critical`,
  accent: `${CARD_STRIPE_BASE} before:bg-primary`,
  neutral: `${CARD_STRIPE_BASE} before:bg-border-strong`,
};

export function rowToneClass(tone: SelectOptionTone | undefined): string {
  return tone === undefined ? "" : ROW_TONE_STRIPE_CLASS[tone];
}

const TONE_DOT_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "bg-status-bad",
  warn: "bg-status-warn",
  ok: "bg-status-ok",
  critical: "bg-status-critical",
  accent: "bg-primary",
  neutral: "bg-status-neutral",
};

/** Background class of the small tone dot that `rowToneMarker: "dot"` draws in front of a row. */
export function toneDotClass(tone: SelectOptionTone): string {
  return TONE_DOT_CLASS[tone];
}

export function cardToneClass(tone: SelectOptionTone | undefined): string {
  return tone === undefined ? "" : CARD_TONE_STRIPE_CLASS[tone];
}

export const NUMERIC_COLUMN_TYPES: ReadonlySet<string> = new Set([
  "number",
  "decimal",
  "bigInt",
  "money",
]);

// Digits stand in columns here, so they need equal-width figures; the body no longer sets tabular-nums.
export const TABULAR_COLUMN_TYPES: ReadonlySet<string> = new Set([
  ...NUMERIC_COLUMN_TYPES,
  "date",
  "timestamp",
  "locatedTimestamp",
]);

// A plain <a>, not DefaultLink: the click must not reach the row's own click
// handler, which opens the same record's row action.
export function CellTextLink({
  link,
  children,
  className = "text-primary underline-offset-4 hover:underline",
}: {
  readonly link: CellLink;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <a
      href={isSafeHref(link.href) ? link.href : "#"}
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        if (!isPlainPrimaryClick(event)) return;
        event.preventDefault();
        link.onPress();
      }}
    >
      {children}
    </a>
  );
}

type FunctionRenderer = (v: unknown, r?: Readonly<Record<string, unknown>>) => string;
type FormatSpecRenderer = { format: string; locale?: string } & Record<string, unknown>;

function isFunctionRenderer(renderer: unknown): renderer is FunctionRenderer {
  return typeof renderer === "function";
}

function isFormatSpecRenderer(renderer: unknown): renderer is FormatSpecRenderer {
  return typeof renderer === "object" && renderer !== null && "format" in renderer;
}

// Same text the cell shows without `display`: a reference-lookup renderer or FormatSpec must win over the raw value.
function plainCellText({
  value,
  row,
  type,
  renderer,
  optionLabels,
  locale,
  field,
  grouping,
  translate,
}: Pick<
  DataTableCellProps,
  "value" | "row" | "type" | "renderer" | "optionLabels" | "locale" | "field" | "translate"
> & { readonly grouping: boolean }): string {
  if (isFunctionRenderer(renderer)) {
    return renderer(value, row);
  }
  if (isFormatSpecRenderer(renderer)) {
    return applyFormatSpec({ ...renderer, locale: renderer.locale ?? locale }, value, translate);
  }
  return defaultCellRender(value, type, optionLabels, locale, field, grouping);
}

// A list column's `display` (badge pill, outline link button); undefined = fall through to the normal paths.
function renderDisplayCell({
  display,
  value,
  textOf,
  row,
  badgeToneField,
  badgeDot,
  emptyPlaceholder,
  link,
}: {
  readonly emptyPlaceholder: string | false | undefined;
  readonly display: DataTableCellProps["display"];
  readonly value: unknown;
  readonly textOf: () => string;
  readonly row: Readonly<Record<string, unknown>>;
  readonly badgeToneField: string | undefined;
  readonly badgeDot: false | undefined;
  readonly link: DataTableCellProps["link"];
}): ReactNode | undefined {
  // A column renderer skips the generic empty-cell path, so a pill or button would otherwise wrap nothing.
  if ((display === "badge" || display === "button") && isEmptyCellValue(value)) {
    return <EmptyCell placeholder={emptyPlaceholder} />;
  }
  if (display === "badge") {
    const toneKey = badgeToneField === undefined ? undefined : row[badgeToneField];
    const tone = (typeof toneKey === "string" ? LIST_BADGE_TONE[toneKey] : undefined) ?? "muted";
    return (
      <StatusBadge tone={tone} dot={badgeDot !== false}>
        {textOf()}
      </StatusBadge>
    );
  }
  if (display === "button" && link !== undefined) {
    return (
      <CellTextLink link={link} className={LINK_BUTTON_CLASS}>
        {textOf()}
      </CellTextLink>
    );
  }
  return undefined;
}

function renderFileCell({
  value,
  fileDisplay,
  compactFile,
  translate,
}: {
  readonly value: unknown;
  readonly fileDisplay: NonNullable<DataTableCellProps["fileDisplay"]>;
  readonly compactFile: boolean;
  readonly translate: DataTableCellProps["translate"];
}): ReactNode {
  const [firstFileId] = fileIdsOf(value);
  return (
    <span className="inline-flex items-center gap-3">
      <FileDisplayCell
        value={value}
        display={fileDisplay}
        compact={compactFile}
        fallbackLabel={translate?.("kumiko.field.file-upload.attached") ?? "File attached"}
      />
      {fileDisplay.kind === "file" &&
        fileDisplay.viewInDrawer === true &&
        firstFileId !== undefined && <FileViewAction fileId={firstFileId} />}
    </span>
  );
}

// Cell renderer as a component (instead of a plain function) so the
// useColumnRenderer hook can read from the provider. The four paths:
//   1. FormatSpec (`{ format: "timestamp" }` etc.) -> applyFormatSpec.
//   2. RuntimeRenderer (function) -> direct call. Only for render-list-
//      internal reference-lookup closures, never from the serialized schema.
//   3. PlatformComponent (`{ react: { __component: "X" } }`) -> looks up
//      "X" via useColumnRenderer and renders `<X value row column/>`.
//      Not registered -> one-time warning + default fallback.
//   4. Otherwise -> defaultCellRender (type-based string renderer).
/** The extra pill a column draws beside its value in a table row, or in the header line of a phone card. */
export function CellPill({
  row,
  pillField,
  pillToneField,
}: {
  readonly row: Readonly<Record<string, unknown>>;
  readonly pillField: string | undefined;
  readonly pillToneField: string | undefined;
}): ReactNode {
  const pillText = pillField === undefined ? undefined : row[pillField];
  if (typeof pillText !== "string" || pillText === "") return null;
  const toneKey = pillToneField === undefined ? undefined : row[pillToneField];
  const tone = (typeof toneKey === "string" ? LIST_BADGE_TONE[toneKey] : undefined) ?? "muted";
  return <StatusBadge tone={tone}>{pillText}</StatusBadge>;
}

export function DataTableCell(props: DataTableCellProps): ReactNode {
  const { pillField, pillToneField, row } = props;
  if (pillField === undefined) return <DataTableCellBody {...props} />;
  const pill = <CellPill row={row} pillField={pillField} pillToneField={pillToneField} />;
  if (isEmptyCellValue(row[pillField])) return <DataTableCellBody {...props} />;
  return (
    <span className="inline-flex items-center gap-2">
      <DataTableCellBody {...props} />
      {pill}
    </span>
  );
}

function DataTableCellBody({
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
  fileDisplay,
  compactFile = false,
  link,
  linkItems,
  hint,
  display,
  badgeToneField,
  badgeDot,
  emptyPlaceholder,
  dateOnlyAfterDays,
  onOpenRow,
}: DataTableCellProps): ReactNode {
  const componentRef = isComponentRendererRef(renderer);
  const ResolvedComponent = useColumnRenderer(componentRef?.name);
  const RegisteredStatusBadge = useOptionalPrimitives()?.StatusBadge;
  if (hint !== undefined) {
    return (
      <HintCell
        value={value}
        row={row}
        hint={hint}
        {...(onOpenRow !== undefined && { onOpen: onOpenRow })}
      />
    );
  }
  // A function renderer formats its own values; only an explicit `emptyPlaceholder` takes an empty value over.
  const showsPlaceholder =
    typeof renderer !== "function"
      ? isEmptyCellValue(value)
      : typeof emptyPlaceholder === "string" &&
        (isEmptyCellValue(value) || (Array.isArray(value) && value.length === 0));
  if (showsPlaceholder && componentRef === undefined) {
    return <EmptyCell placeholder={emptyPlaceholder} />;
  }
  if (value === PII_ERASED_SENTINEL && translate !== undefined) {
    return translate("kumiko.pii.erased");
  }
  const displayCell = renderDisplayCell({
    display,
    value,
    textOf: () =>
      plainCellText({
        value,
        row,
        type,
        renderer,
        optionLabels,
        locale,
        field,
        grouping,
        translate,
      }),
    row,
    badgeToneField,
    badgeDot,
    emptyPlaceholder,
    link,
  });
  if (displayCell !== undefined) return displayCell;
  const dateOnlyText =
    dateOnlyAfterDays === undefined
      ? undefined
      : dateOnlyWhenOlderThan(value, dateOnlyAfterDays, locale, renderer);
  if (dateOnlyText !== undefined) {
    return link === undefined ? (
      dateOnlyText
    ) : (
      <CellTextLink link={link}>{dateOnlyText}</CellTextLink>
    );
  }
  if (
    typeof value === "boolean" &&
    isBooleanColumn(type, renderer) &&
    (renderer === undefined || isUnlabeledBooleanFormat(renderer))
  ) {
    return <BooleanCell value={value} translate={translate} />;
  }
  if (isUnlabeledFalse(type, value, renderer)) return <EmptyCell placeholder={emptyPlaceholder} />;
  if (fileDisplay !== undefined) {
    return renderFileCell({ value, fileDisplay, compactFile, translate });
  }
  if (isFormatSpecRenderer(renderer)) {
    return renderFormatSpecCell({
      renderer,
      value,
      translate,
      locale,
      link,
      RegisteredStatusBadge,
    });
  }
  if (isFunctionRenderer(renderer)) {
    return renderFunctionRendererCell({ renderer, value, row, link, linkItems });
  }
  if (componentRef !== undefined) {
    if (ResolvedComponent !== undefined) {
      return renderResolvedComponentCell({ ResolvedComponent, value, row, field, onChange });
    }
    // Renderer referenced in the schema but no map entry client-side —
    // typical case: clientFeatures.columnRenderers forgotten or a typo in the
    // __component key. Warn instead of crashing so a schema boot still works
    // (the default type renderer takes over).
    rendererWarn(`[kumiko] columnRenderer "${componentRef.name}" not registered`);
  }
  const selectCell = renderSelectTypeCell({
    type,
    value,
    optionLabels,
    optionTones,
    locale,
    RegisteredStatusBadge,
  });
  if (selectCell !== undefined) return selectCell;
  const text = defaultCellRender(value, type, optionLabels, locale, field, grouping);
  return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
}

function renderFormatSpecCell({
  renderer,
  value,
  translate,
  locale,
  link,
  RegisteredStatusBadge,
}: {
  renderer: FormatSpecRenderer;
  value: unknown;
  translate: DataTableCellProps["translate"];
  locale: string | undefined;
  link: DataTableCellProps["link"];
  RegisteredStatusBadge: PrimitivesRegistry["StatusBadge"];
}): ReactNode {
  const text = applyFormatSpec(
    { ...renderer, locale: renderer.locale ?? locale },
    value,
    translate,
  );
  const phoneHref = renderer.format === "phone" ? telHref(text) : undefined;
  if (phoneHref !== undefined) {
    return (
      <CellTextLink link={{ href: phoneHref, onPress: () => window.location.assign(phoneHref) }}>
        {text}
      </CellTextLink>
    );
  }
  const tones = enumOptionTones(renderer);
  if (tones !== undefined && typeof value === "string") {
    return selectPill(value, { [value]: text }, tones, locale, RegisteredStatusBadge);
  }
  return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
}

function renderFunctionRendererCell({
  renderer,
  value,
  row,
  link,
  linkItems,
}: {
  renderer: FunctionRenderer;
  value: unknown;
  row: Record<string, unknown>;
  link: DataTableCellProps["link"];
  linkItems: DataTableCellProps["linkItems"];
}): ReactNode {
  if (linkItems !== undefined) {
    const linkItemKeys = uniqueLinkItemKeys(linkItems);
    return (
      <>
        {linkItems.map((item, index) => (
          <Fragment key={linkItemKeys[index]}>
            {index > 0 && ", "}
            {item.link === undefined ? (
              item.label
            ) : (
              <CellTextLink link={item.link}>{item.label}</CellTextLink>
            )}
          </Fragment>
        ))}
      </>
    );
  }
  const text = renderer(value, row);
  return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
}

function renderResolvedComponentCell({
  ResolvedComponent,
  value,
  row,
  field,
  onChange,
}: {
  ResolvedComponent: NonNullable<ReturnType<typeof useColumnRenderer>>;
  value: unknown;
  row: Record<string, unknown>;
  field: string;
  onChange: DataTableCellProps["onChange"];
}): ReactNode {
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
  if (onChange === undefined) return node;
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

// A select value renders as a pill instead of plain text. When the raw
// value is a known status word, it carries the same tone as the
// projectionDetail header badge — a status column stayed grey while the
// detail view of the same value was coloured. Unknown values
// keep the neutral outline pill.
function renderSelectTypeCell({
  type,
  value,
  optionLabels,
  optionTones,
  locale,
  RegisteredStatusBadge,
}: {
  type: DataTableCellProps["type"];
  value: unknown;
  optionLabels: DataTableCellProps["optionLabels"];
  optionTones: DataTableCellProps["optionTones"];
  locale: string | undefined;
  RegisteredStatusBadge: PrimitivesRegistry["StatusBadge"];
}): ReactNode | undefined {
  if (type === "select" && value !== null && value !== undefined && value !== "") {
    return selectPill(value, optionLabels, optionTones, locale, RegisteredStatusBadge);
  }
  // One pill per picked value; a single pill would hold the whole joined list.
  if (type === "multiSelect" && Array.isArray(value) && value.length > 0) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((entry) => (
          <Fragment key={String(entry)}>
            {selectPill(entry, optionLabels, optionTones, locale, RegisteredStatusBadge)}
          </Fragment>
        ))}
      </span>
    );
  }
  return undefined;
}
