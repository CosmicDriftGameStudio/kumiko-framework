import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { SELECT_OPTION_TONES } from "@cosmicdrift/kumiko-types/fields";
import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-types/kms-adapter-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { Check } from "lucide-react";
import { Fragment, type MouseEvent, type ReactNode } from "react";
import { rendererWarn } from "../../dev-console.ts";
import type {
  CellLink,
  CellLinkItem,
  ListColumnFileDisplay,
  ListRowViewModel,
  RuntimeCellLink,
  RuntimeCellLinkItems,
} from "../../headless/index.ts";
import { applyFormatSpec, EMPTY_VALUE_PLACEHOLDER, isSafeHref } from "../../headless/index.ts";
import {
  type PrimitivesRegistry,
  statusToneForOptionTone,
  statusToneForValue,
  useColumnRenderer,
  useOptionalPrimitives,
} from "../../index.ts";
import { Badge } from "../ui/badge.tsx";
import { StatusBadge } from "../widgets/status-badge.tsx";
import { FileDisplayCell } from "./file-thumbnail.tsx";
import { currencyDecimals, formatMoney } from "./money-input.tsx";
import "../react-css-custom-properties.ts";
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

// Tooltip text for truncated cells: on hover the browser shows the
// full text. Skipped for object/array (not user-readable);
// the browser stringifies numbers correctly anyway; booleans get no raw true/false tooltip.
export function cellTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function selectPill(
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

function isSelectOptionTone(value: unknown): value is SelectOptionTone {
  return SELECT_OPTION_TONES.some((tone) => tone === value);
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

const ROW_TONE_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "bg-status-bad/10 hover:bg-status-bad/15",
  warn: "bg-status-warn/10 hover:bg-status-warn/15",
  ok: "bg-status-ok/10 hover:bg-status-ok/15",
  neutral: "",
};

export function rowToneClass(tone: SelectOptionTone | undefined): string {
  return tone === undefined ? "" : ROW_TONE_CLASS[tone];
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
function CellTextLink({
  link,
  children,
}: {
  readonly link: CellLink;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <a
      href={isSafeHref(link.href) ? link.href : "#"}
      className="text-primary underline-offset-4 hover:underline"
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

// Cell renderer as a component (instead of a plain function) so the
// useColumnRenderer hook can read from the provider. The four paths:
//   1. FormatSpec (`{ format: "timestamp" }` etc.) -> applyFormatSpec.
//   2. RuntimeRenderer (function) -> direct call. Only for render-list-
//      internal reference-lookup closures, never from the serialized schema.
//   3. PlatformComponent (`{ react: { __component: "X" } }`) -> looks up
//      "X" via useColumnRenderer and renders `<X value row column/>`.
//      Not registered -> one-time warning + default fallback.
//   4. Otherwise -> defaultCellRender (type-based string renderer).
export function DataTableCell({
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
}: DataTableCellProps): ReactNode {
  const componentRef = isComponentRendererRef(renderer);
  const ResolvedComponent = useColumnRenderer(componentRef?.name);
  const RegisteredStatusBadge = useOptionalPrimitives()?.StatusBadge;
  if (isEmptyCellValue(value) && typeof renderer !== "function" && componentRef === undefined) {
    return (
      <span data-empty-cell="true" className="text-muted-foreground">
        {EMPTY_VALUE_PLACEHOLDER}
      </span>
    );
  }
  if (value === PII_ERASED_SENTINEL && translate !== undefined) {
    return translate("kumiko.pii.erased");
  }
  if (
    typeof value === "boolean" &&
    isBooleanColumn(type, renderer) &&
    (renderer === undefined || isUnlabeledBooleanFormat(renderer))
  ) {
    return <BooleanCell value={value} translate={translate} />;
  }
  if (isUnlabeledFalse(type, value, renderer)) {
    return (
      <span data-empty-cell="true" className="text-muted-foreground">
        {EMPTY_VALUE_PLACEHOLDER}
      </span>
    );
  }
  if (fileDisplay !== undefined) {
    return (
      <FileDisplayCell
        value={value}
        display={fileDisplay}
        compact={compactFile}
        fallbackLabel={translate?.("kumiko.field.file-upload.attached") ?? "File attached"}
      />
    );
  }
  if (typeof renderer === "object" && renderer !== null && "format" in renderer) {
    const spec = renderer as { format: string; locale?: string } & Record<string, unknown>;
    const text = applyFormatSpec({ ...spec, locale: spec.locale ?? locale }, value, translate);
    const tones = enumOptionTones(spec);
    if (tones !== undefined && typeof value === "string") {
      return selectPill(value, { [value]: text }, tones, locale, RegisteredStatusBadge);
    }
    return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
  }
  if (typeof renderer === "function") {
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
    const fn = renderer as (v: unknown, r?: Readonly<Record<string, unknown>>) => string;
    const text = fn(value, row);
    return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
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
    // Renderer referenced in the schema but no map entry client-side —
    // typical case: clientFeatures.columnRenderers forgotten or a typo in the
    // __component key. Warn instead of crashing so a schema boot still works
    // (the default type renderer takes over).
    rendererWarn(`[kumiko] columnRenderer "${componentRef.name}" not registered`);
  }
  // A select value renders as a pill instead of plain text. When the raw
  // value is a known status word, it carries the same tone as the
  // projectionDetail header badge — a status column stayed grey while the
  // detail view of the same value was coloured. Unknown values
  // keep the neutral outline pill.
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
  const text = defaultCellRender(value, type, optionLabels, locale, field, grouping);
  return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
}
