import type {
  ActionFormLoad,
  ActionFormSuccessFact,
  ActionFormValueType,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useMemo } from "react";
import { fileIdsOf } from "../file-ids-of.ts";
import {
  applyFormatSpec,
  type DispatcherError,
  formatMoneyValue,
  type Translate,
} from "../headless/index.ts";
import { useQuery } from "../hooks/use-query.ts";
import { usePrimitives } from "../primitives.tsx";
import { isMoneyValue } from "./entity-edit-prefill.ts";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { dispatcherErrorText } from "./write-failed-error.ts";

export const DEFAULT_LOAD_ID_PARAM = "id";

function nonEmptyId(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  return typeof value === "number" ? String(value) : undefined;
}

/** Record id of a `load` form: the route path id, else the drawer prefill `id`
 *  (the clicked row), else the URL `id` param. Only the id is read from these
 *  sources, never another value. */
export function resolveActionFormRecordId(sources: {
  readonly routeEntityId: string | undefined;
  readonly drawerOverrides: Readonly<Record<string, unknown>> | undefined;
  readonly searchParams: Readonly<Record<string, string>>;
}): string | undefined {
  return (
    nonEmptyId(sources.routeEntityId) ??
    nonEmptyId(sources.drawerOverrides?.[DEFAULT_LOAD_ID_PARAM]) ??
    nonEmptyId(sources.searchParams[DEFAULT_LOAD_ID_PARAM])
  );
}

export type ActionFormLoadState =
  | { readonly status: "missing-id" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: DispatcherError }
  | { readonly status: "missing-record" }
  | {
      readonly status: "ready";
      readonly values: Readonly<Record<string, unknown>>;
      /** `summary.paramsFromLoad` picked from the raw load result. */
      readonly summaryValues: Readonly<Record<string, unknown>>;
      readonly refetch: () => Promise<void>;
    };

/** A sensitive, writeOnly or password field never takes a value from a loaded
 *  record: the form must not echo a secret back into an input. */
export function isSecretFormField(field: unknown): boolean {
  return (
    propertyOf(field, "sensitive") === true ||
    propertyOf(field, "writeOnly") === true ||
    propertyOf(field, "format") === "password"
  );
}

function pickDeclaredFields(
  record: unknown,
  fieldNames: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof record !== "object" || record === null) return {};
  const picked: Record<string, unknown> = {};
  for (const name of fieldNames) {
    const value: unknown = Object.hasOwn(record, name) ? Reflect.get(record, name) : undefined;
    if (value !== undefined && value !== null) picked[name] = value;
  }
  return picked;
}

const NO_FIELDS: readonly string[] = [];

/** Loads the initial values of an actionForm declaring `load`; undefined for a
 *  form without `load`. */
export function useActionFormLoad(
  load: ActionFormLoad | undefined,
  recordId: string | undefined,
  fieldNames: readonly string[],
  summaryFieldNames: readonly string[] = NO_FIELDS,
  prefill?: Readonly<Record<string, unknown>>,
): ActionFormLoadState | undefined {
  const isSingleton = load?.singleton === true;
  const query = useQuery<unknown>(
    load?.query ?? "",
    {
      ...(load?.passPrefill === true && prefill),
      ...(isSingleton ? {} : { [load?.idParam ?? DEFAULT_LOAD_ID_PARAM]: recordId }),
    },
    { enabled: load !== undefined && (isSingleton || recordId !== undefined) },
  );
  const values = useMemo(
    () => pickDeclaredFields(query.data, fieldNames),
    [query.data, fieldNames],
  );
  const summaryValues = useMemo(
    () => pickDeclaredFields(query.data, summaryFieldNames),
    [query.data, summaryFieldNames],
  );
  if (load === undefined) return undefined;
  if (!isSingleton && recordId === undefined) return { status: "missing-id" };
  if (query.error !== null) return { status: "error", error: query.error };
  if (query.loading) return { status: "loading" };
  if (query.data === null) return { status: "missing-record" };
  return { status: "ready", values, summaryValues, refetch: query.refetch };
}

/** Banner for every `load` state that is not "ready". */
export function ActionFormLoadStatus({
  state,
  screenId,
  translate,
}: {
  readonly state: Exclude<ActionFormLoadState, { readonly status: "ready" }>;
  readonly screenId: string;
  readonly translate: Translate;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  switch (state.status) {
    case "loading":
      return <QueryLoadingBanner />;
    case "error":
      return (
        <Banner padded variant="error" testId="kumiko-screen-error">
          {dispatcherErrorText(state.error, translate)}
        </Banner>
      );
    case "missing-record":
      return (
        <Banner padded variant="error" testId="kumiko-screen-record-missing">
          {translate("kumiko.record.not-found.title")}
        </Banner>
      );
    case "missing-id":
      return (
        <Banner padded variant="error" testId="kumiko-screen-action-form-missing-id">
          Screen <Text variant="code">{screenId}</Text> (actionForm with load) needs a record id in
          the path or the clicked row.
        </Banner>
      );
    default: {
      const exhaustiveCheck: never = state;
      return exhaustiveCheck;
    }
  }
}

export type ResolvedSuccessLink = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly onPress: () => void;
};

export type ResolvedSuccessFact = {
  readonly key: string;
  readonly label: string;
  readonly lines: readonly string[];
  /** Set for a `file` fact: stored file ids shown as a file list instead of lines. */
  readonly fileIds?: readonly string[];
  readonly emphasize?: boolean;
};

export type ResolvedSuccessItem = {
  readonly key: string;
  readonly label: string;
  readonly link?: ResolvedSuccessLink;
};

export type ActionFormSuccessState = {
  readonly text: string;
  readonly links: readonly ResolvedSuccessLink[];
  readonly facts: readonly ResolvedSuccessFact[];
  /** Per-entry hints; while any is shown they replace `text`. */
  readonly items?: readonly ResolvedSuccessItem[];
};

function formatTypedFact(
  entry: unknown,
  type: ActionFormValueType | undefined,
  locale: string,
): string | undefined {
  if (type === "money" && isMoneyValue(entry)) {
    return formatMoneyValue(entry, { locale });
  }
  if ((type === "date" || type === "timestamp") && typeof entry === "string") {
    return applyFormatSpec({ format: type, locale }, entry);
  }
  return undefined;
}

function factLine(entry: unknown, locale: string): string | undefined {
  if (typeof entry === "number") return entry.toLocaleString(locale);
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "label" in entry) {
    return typeof entry.label === "string" ? entry.label : undefined;
  }
  return undefined;
}

export function resolveSuccessFacts(
  facts: readonly ActionFormSuccessFact[] | undefined,
  data: unknown,
  translate: (key: string) => string,
  locale: string,
): readonly ResolvedSuccessFact[] {
  const resolved: ResolvedSuccessFact[] = [];
  (facts ?? []).forEach((fact, index) => {
    const value = propertyOf(data, fact.field);
    const valueType = fact.type;
    if (valueType === "file") {
      const fileIds = fileIdsOf(value);
      if (fileIds.length > 0) {
        resolved.push({ key: String(index), label: translate(fact.label), lines: [], fileIds });
      }
      return;
    }
    const entries = Array.isArray(value) ? value : [value];
    const rawLines = entries.flatMap(
      (entry) => formatTypedFact(entry, valueType, locale) ?? factLine(entry, locale) ?? [],
    );
    const lines = fact.valueIsI18nKey === true ? rawLines.map(translate) : rawLines;
    if (lines.length > 0) {
      resolved.push({
        key: String(index),
        label: translate(fact.label),
        lines,
        ...(fact.emphasize === true && { emphasize: true }),
      });
    }
  });
  return resolved;
}

// Lines can repeat (two files with one name), so the position is the only stable key.
function positionedLines(
  lines: readonly string[],
): readonly { readonly position: string; readonly line: string }[] {
  return lines.map((line, position) => ({ position: String(position), line }));
}

function SuccessItemHints({
  items,
}: {
  readonly items: readonly ResolvedSuccessItem[];
}): ReactNode {
  const { Banner, Grid, Link, Text } = usePrimitives();
  return (
    <Grid columns={1} testId="action-form-success-items">
      {items.map((item) => (
        <Banner
          key={item.key}
          variant="hint"
          testId={`action-form-success-item-${item.key}`}
          {...(item.link !== undefined && {
            actions: (
              <Link
                href={item.link.href}
                onPress={item.link.onPress}
                className="underline"
                testId={`action-form-success-item-${item.key}-link`}
              >
                {item.link.label}
              </Link>
            ),
          })}
        >
          <Text>{item.label}</Text>
        </Banner>
      ))}
    </Grid>
  );
}

type SingleLineFact = ResolvedSuccessFact & { readonly lines: readonly [string] };

// ponytail: length stands in for "would wrap"; a right-aligned value that wraps reads ragged,
// so prose such as a hint or a note goes to the block form with its label above.
const NAME_VALUE_MAX_LENGTH = 40;

function isSingleLineFact(fact: ResolvedSuccessFact): fact is SingleLineFact {
  const [line] = fact.lines;
  return (
    fact.fileIds === undefined &&
    fact.lines.length === 1 &&
    line !== undefined &&
    line.length <= NAME_VALUE_MAX_LENGTH
  );
}

type FactSegment =
  | { readonly kind: "single-lines"; readonly facts: readonly SingleLineFact[] }
  | { readonly kind: "other"; readonly fact: ResolvedSuccessFact };

// Consecutive single-line facts share one name-value list so values line up in one column.
function segmentFacts(facts: readonly ResolvedSuccessFact[]): readonly FactSegment[] {
  const segments: FactSegment[] = [];
  for (const fact of facts) {
    if (!isSingleLineFact(fact)) {
      segments.push({ kind: "other", fact });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "single-lines") {
      segments[segments.length - 1] = { kind: "single-lines", facts: [...last.facts, fact] };
    } else {
      segments.push({ kind: "single-lines", facts: [fact] });
    }
  }
  return segments;
}

/** Single-line facts as a name-value list (or KPI tiles), a list of values or files as a block; shared by the success box and the preview panel. */
export function ActionFormFacts({
  testIdPrefix = "action-form-success-fact",
  facts,
  tiles = false,
}: {
  readonly facts: readonly ResolvedSuccessFact[];
  readonly testIdPrefix?: string;
  readonly tiles?: boolean;
}): ReactNode {
  const { FileValueList, Grid, KeyValueList, Metric, MetricBand, Text } = usePrimitives();
  return segmentFacts(facts).map((segment) => {
    if (segment.kind === "single-lines" && tiles) {
      return (
        <MetricBand key={segment.facts[0]?.key} tiles flush>
          {segment.facts.map((fact) => (
            <Metric
              key={fact.key}
              tile
              label={fact.label}
              value={fact.lines[0]}
              {...(fact.emphasize === true && { emphasize: true })}
              testId={`${testIdPrefix}-${fact.key}`}
            />
          ))}
        </MetricBand>
      );
    }
    if (segment.kind === "single-lines") {
      return (
        <KeyValueList
          key={segment.facts[0]?.key}
          rows={segment.facts.map((fact) => ({
            key: fact.key,
            label: fact.label,
            value: fact.lines[0],
            testId: `${testIdPrefix}-${fact.key}`,
            ...(fact.emphasize === true && { emphasize: true }),
          }))}
        />
      );
    }
    const { fact } = segment;
    const factTestId = `${testIdPrefix}-${fact.key}`;
    if (fact.fileIds !== undefined) {
      return (
        <Grid key={fact.key} columns={1} testId={factTestId}>
          <Text variant="muted">{fact.label}</Text>
          <FileValueList fileIds={fact.fileIds} testId={`${factTestId}-files`} />
        </Grid>
      );
    }
    return (
      <Grid key={fact.key} columns={1} testId={factTestId}>
        <Text variant="muted">{fact.label}</Text>
        {positionedLines(fact.lines).map(({ position, line }) => (
          <Text key={position} testId={`${factTestId}-line-${position}`}>
            {line}
          </Text>
        ))}
      </Grid>
    );
  });
}

export function ActionFormSuccessBanner({
  success,
}: {
  readonly success: ActionFormSuccessState;
}): ReactNode {
  const { Banner, Grid, Link, Text } = usePrimitives();
  const items = success.items ?? [];
  const hasFactsOrLinks = success.facts.length > 0 || success.links.length > 0;
  if (items.length > 0 && !hasFactsOrLinks) return <SuccessItemHints items={items} />;
  // Text renders inline, so the message and each fact sit in a one-column grid to get their own lines.
  const banner = (
    <Banner variant="info" testId="action-form-success">
      <Grid columns={1}>
        {items.length === 0 && <Text testId="action-form-success-text">{success.text}</Text>}
        <ActionFormFacts facts={success.facts} />
      </Grid>
      {success.links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          onPress={link.onPress}
          className="ml-2 underline"
          testId={`action-form-success-link-${link.key}`}
        >
          {link.label}
        </Link>
      ))}
    </Banner>
  );
  if (items.length === 0) return banner;
  return (
    <Grid columns={1}>
      <SuccessItemHints items={items} />
      {banner}
    </Grid>
  );
}
