import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  currencyDecimals,
  type EditFieldViewModel,
  type FieldIssue,
} from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useAppFeatures } from "../app/app-features-context";
import { toKebab } from "../app/qn";
import { screenAccessAllows } from "../app/screen-access";
import { useUserRoles } from "../context/user-roles-context";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits";
import { useQuery } from "../hooks/use-query";
import { useLocale, useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { EmbeddedListField } from "./embedded-list-field";
import { ReferenceCreateDialog } from "./reference-create-dialog";

// RenderField übersetzt ein EditFieldViewModel → Primitives-Baum.
// Kein raw HTML mehr; alle Darstellungsentscheidungen (Label-Position,
// Fehler-Layout, Input-Styling) leben in der Primitives-Implementation.
//
// Der field.type → Input-kind Mapping bleibt hier, weil es
// Domain-Logik ist (EntityDefinition-Feldtyp) und nicht Darstellung.

export type RenderFieldProps = {
  readonly field: EditFieldViewModel;
  readonly issues?: readonly FieldIssue[];
  readonly onChange: (val: unknown) => void;
  /** Nur bei type:"reference" relevant — Feature-Name für die Lookup-
   *  Query-QN (`<feature>:query:<refEntity>:list`). Andere Field-Types
   *  ignorieren das Prop. */
  readonly featureName?: string;
  /** Optionaler Zusatz-Inhalt der nach dem Label gerendert wird (z.B.
   *  ConfigSourceBadge). */
  readonly labelAppendix?: ReactNode;
  /** Optionaler Zusatz-Inhalt der nach dem Input gerendert wird (z.B.
   *  ConfigCascade). */
  readonly fieldAppendix?: ReactNode;
  /** Flat issues-by-path map (FormSnapshot.errors) — only relevant for
   *  type:"embedded" with embeddedListCells, to bucket row-/cell-issues
   *  (`${field}.${rowIndex}` / `${field}.${rowIndex}.${cellField}`).
   *  Other field types ignore this prop. */
  readonly allIssues?: Readonly<Record<string, readonly FieldIssue[]>>;
};

export function RenderField({
  field,
  issues,
  onChange,
  featureName,
  labelAppendix,
  fieldAppendix,
  allIssues,
}: RenderFieldProps): ReactNode {
  const { Field, Input, Banner, Text } = usePrimitives();
  // App-Locale (i18n) für money/date-Inputs — sonst fielen sie auf
  // navigator.language (Browser-Sprache) zurück statt der gewählten
  // App-Sprache. BEWUSSTE API-Verschärfung (seit 0.38): RenderField ist
  // public exportiert und verlangt jetzt einen LocaleProvider —
  // Standalone-Consumer/Tests müssen wrappen (createKumikoApp tut es).
  const appLocale = useLocale().locale();
  const t = useTranslation();
  if (!field.visible) return null;

  const id = inputId(field);
  const hasError = issues !== undefined && issues.length > 0;

  // Reference-Field rendert eine eigene Component — sie nutzt
  // useQuery() für den Live-Lookup, also muss sie als React-
  // Komponente gemountet werden (nicht als pure render-Call).
  const control =
    field.type === "embedded" && field.embeddedListCells !== undefined ? (
      <EmbeddedListField
        field={field}
        id={id}
        onChange={onChange}
        allIssues={allIssues ?? {}}
        featureName={featureName ?? ""}
      />
    ) : field.type === "reference" ? (
      <ReferenceInput
        field={field}
        id={id}
        hasError={hasError}
        onChange={onChange}
        Input={Input}
        featureName={featureName ?? ""}
      />
    ) : (
      renderInput({ field, id, hasError, onChange, Input, appLocale, Banner, Text, t })
    );

  return (
    <Field
      id={id}
      label={field.label}
      required={field.required}
      {...(issues !== undefined && { issues })}
      {...(labelAppendix !== undefined && { labelAppendix })}
      {...(fieldAppendix !== undefined && { fieldAppendix })}
      {...(field.type === "boolean" && { layout: "inline" as const })}
      testId={`field-${field.field}`}
    >
      {control}
    </Field>
  );
}

// Tier 2.7e-3 + 2.1c: Reference-Input rendert eine Searchable Combobox
// gefüllt aus einer Live-Query auf die referenced Entity. Default-
// Limit: 200 — bei größeren Datasets fehlt der Tail im Dropdown
// (Tier 2.7e-Remote: server-side Search-Query mit debounce kommt später).
//   - Display = row[refLabelField], Default labelField "id".
//   - Loading-State: leeres Dropdown bis die rows da sind. Field
//     ist disabled während useQuery läuft.
//   - Multi-Mode (Tier 2.7e-Multi via field.refMultiple): value ist
//     ein UUID-Array, Combobox rendert Selected-Tags.
//
// Storage: UI-Wert ist UUID (row.id) oder UUID-Array bei multiple.
// Server-Schema: z.uuid() bzw. z.array(z.uuid()).
// REFERENCE_COMBOBOX_LIMIT lebt zentral in hooks/reference-limits.ts
// (siehe dort für Begründung der Default-Werte).

function ReferenceInput({
  field,
  id,
  hasError,
  onChange,
  Input,
  featureName,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: ReturnType<typeof usePrimitives>["Input"];
  readonly featureName: string;
}): ReactNode {
  const { Banner } = usePrimitives();
  const refEntity = field.refEntity ?? "";
  const refFeature = field.refFeature ?? featureName;
  const labelField = field.refLabelField ?? "id";
  const isMultiple = field.refMultiple === true;
  // Tier 2.7e Cross-Feature: refFeature kann ≠ featureName sein
  // (z.B. items.assignee → users:query:user:list). Default ist
  // same-feature, kommt aus dem ViewModel (parseRefTarget).
  const queryQn = `${toKebab(refFeature)}:query:${toKebab(refEntity)}:list`;
  // Issue #1681: "+ Neu" in der Combobox öffnet den Create-Screen der
  // referenced entity als Dialog, statt die aktuelle Form zu verlassen.
  // refFeature kann ein anderes Feature als das aktuell gerenderte sein
  // — appFeatures (createKumikoApp) kennt alle Feature-Schemas, nicht
  // nur das der aktiven Screen. Kein Match (Feature/Screen/Entity nicht
  // registriert, oder allowCreate:false) → onCreate bleibt undefined,
  // Combobox rendert dann ohne den Footer.
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const t = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const refTargetSchema = appFeatures.find((f) => f.featureName === refFeature);
  const refCreateScreen = refTargetSchema?.screens.find(
    (s): s is EntityEditScreenDefinition =>
      s.type === "entityEdit" &&
      s.entity === refEntity &&
      s.allowCreate !== false &&
      screenAccessAllows(s.access, userRoles),
  );
  const refEntityDef = refTargetSchema?.entities[refEntity];
  // Tier 2.7e Remote-Search: User tippt im Combobox → Server filtert
  // via existing list-payload `search`-Param (Tier 2.6c). Combobox
  // debounced den keystroke selbst (300ms) und ruft onSearchChange.
  // Initial-State leer → erste 50 Items vom Server (default-sortiert).
  const [searchTerm, setSearchTerm] = useState("");
  const queryPayload = useMemo<Record<string, unknown>>(
    () =>
      searchTerm === ""
        ? { limit: REFERENCE_COMBOBOX_LIMIT }
        : { limit: REFERENCE_COMBOBOX_LIMIT, search: searchTerm },
    [searchTerm],
  );
  const queryResult = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(
    queryQn,
    queryPayload,
  );
  const handleSearchChange = useCallback((q: string) => setSearchTerm(q), []);
  const canCreate = !field.readOnly && refCreateScreen !== undefined && refEntityDef !== undefined;
  const [createdWithoutIdWarning, setCreatedWithoutIdWarning] = useState(false);
  const handleCreated = useCallback(
    (newId: string | undefined) => {
      setCreateOpen(false);
      // Clear the search filter before refetching — the just-created record
      // won't match whatever the user had typed pre-create, and would then
      // be missing from `options` (shown as a raw id instead of a label).
      setSearchTerm("");
      queryResult.refetch().catch((err: unknown) => {
        // biome-ignore lint/suspicious/noConsole: no error-surfacing path exists in this widget yet — at minimum, don't swallow it silently.
        console.error("render-field: refetch after create failed", err);
      });
      if (newId === undefined) {
        // Record was created server-side but the payload carried no id —
        // can't auto-select it, surface that instead of failing silently.
        setCreatedWithoutIdWarning(true);
        return;
      }
      setCreatedWithoutIdWarning(false);
      if (isMultiple) {
        const current = Array.isArray(field.value) ? (field.value as readonly string[]) : [];
        onChange([...current, newId]);
      } else {
        onChange(newId);
      }
    },
    [isMultiple, field.value, onChange, queryResult.refetch],
  );
  const options = useMemo(() => {
    const rows = queryResult.data?.rows ?? [];
    return rows.map((row) => {
      const idVal = String(row["id"] ?? "");
      const label = String(row[labelField] ?? idVal);
      return { value: idVal, label };
    });
  }, [queryResult.data, labelField]);
  // Single: value ist String/null; Multi: Array. Coerce auf das was
  // der Combobox-Mode erwartet, damit Storage-Drift (Server liefert
  // alten String wo jetzt Array erwartet wird) keine Crash auslöst.
  const baseInputProps = {
    id,
    name: field.field,
    // Initial-Load disabled — danach loading-Indicator im Popover.
    disabled: field.readOnly || (queryResult.loading && options.length === 0),
    required: field.required,
    hasError,
    options,
    onSearchChange: handleSearchChange,
    loading: queryResult.loading,
    ...(canCreate && {
      onCreate: () => setCreateOpen(true),
      createLabel: t("kumiko.actions.create"),
    }),
  } as const;
  const createDialog = (
    <>
      {canCreate && refCreateScreen && refEntityDef && (
        <ReferenceCreateDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          featureName={refFeature}
          screen={refCreateScreen}
          entity={refEntityDef}
        />
      )}
      {createdWithoutIdWarning && (
        <Banner variant="error">{t("kumiko.field.reference-created-no-id")}</Banner>
      )}
    </>
  );
  if (isMultiple) {
    const arrayValue: readonly string[] = Array.isArray(field.value)
      ? (field.value as readonly string[])
      : [];
    return (
      <>
        <Input
          kind="combobox"
          {...baseInputProps}
          multiple
          value={arrayValue}
          onChange={(v) => onChange(v)}
        />
        {createDialog}
      </>
    );
  }
  const stringValue = field.value === undefined || field.value === null ? "" : String(field.value);
  return (
    <>
      <Input
        kind="combobox"
        {...baseInputProps}
        value={stringValue}
        onChange={(v) => onChange(v === "" ? null : v)}
      />
      {createDialog}
    </>
  );
}

function inputId(field: EditFieldViewModel): string {
  return `kumiko-edit-${field.field}`;
}

// Dispatches field.type → Input-kind. Select threads options through
// from the EditFieldViewModel (computeEditViewModel pulls them from
// SelectFieldDef.options). Structural types without a widget (embedded,
// jsonb, multiSelect) render read-only instead of a data-destroying text
// fallback (#1834); truly unknown scalar types still fall back to text.
function renderInput({
  field,
  id,
  hasError,
  onChange,
  Input,
  appLocale,
  Banner,
  Text,
  t,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: ReturnType<typeof usePrimitives>["Input"];
  readonly appLocale: string;
  readonly Banner: ReturnType<typeof usePrimitives>["Banner"];
  readonly Text: ReturnType<typeof usePrimitives>["Text"];
  readonly t: ReturnType<typeof useTranslation>;
}): ReactNode {
  const common = {
    id,
    name: field.field,
    disabled: field.readOnly,
    required: field.required,
    hasError,
  } as const;

  switch (field.type) {
    // decimal/bigInt are both plain numbers on the wire (fieldToZod:
    // z.number() / z.number().int().safe()) — the number input's onChange
    // already emits `number | undefined`, so no extra coercion is needed
    // beyond what "number" already does (#1925).
    case "number":
    case "bigInt":
      return (
        <Input
          kind="number"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
          {...(field.icon !== undefined && { icon: field.icon })}
        />
      );
    case "decimal":
      // step="any" disables the native stepMismatch constraint — without it
      // <input type="number"> defaults to step=1 and blocks form submit on
      // any fractional value via silent browser-native validation.
      return (
        <Input
          kind="number"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
          step="any"
          {...(field.icon !== undefined && { icon: field.icon })}
        />
      );
    case "tz":
      return (
        <Input
          kind="tz"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
        />
      );
    case "multiSelect": {
      const rawOptions = field.options ?? [];
      const labels = field.optionLabels;
      const multiSelectOptions =
        labels !== undefined
          ? rawOptions.map((value: string) => ({ value, label: labels[value] ?? value }))
          : rawOptions.map((value: string) => ({ value, label: value }));
      const arrayValue = Array.isArray(field.value) ? (field.value as readonly string[]) : [];
      return (
        <Input
          kind="combobox"
          {...common}
          multiple
          value={arrayValue}
          onChange={(v) => onChange(v)}
          options={multiSelectOptions}
        />
      );
    }
    case "money": {
      const currency = field.currency ?? "EUR";
      return (
        <Input
          kind="money"
          {...common}
          value={moneyMinorValue(field.value, currency)}
          onChange={(v) => onChange(moneyPayload(v, currency))}
          currency={currency}
          locale={appLocale}
        />
      );
    }
    case "boolean":
      return (
        <Input
          kind="boolean"
          {...common}
          value={field.value === true}
          onChange={(v) => onChange(v)}
        />
      );
    case "date":
      return (
        <Input
          kind="date"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
          locale={field.dateLocale ?? appLocale}
          {...(field.min !== undefined && { min: field.min })}
          {...(field.max !== undefined && { max: field.max })}
        />
      );
    case "timestamp":
      return (
        <Input
          kind="timestamp"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
          locale={field.dateLocale ?? appLocale}
          {...(field.wallClock !== undefined && { wallClock: field.wallClock })}
          {...(field.min !== undefined && { min: field.min })}
          {...(field.max !== undefined && { max: field.max })}
        />
      );
    case "locatedTimestamp":
      return (
        <Input
          kind="locatedTimestamp"
          {...common}
          value={locatedValue(field.value)}
          onChange={(v) => onChange(v)}
          locale={field.dateLocale ?? appLocale}
          {...(field.min !== undefined && { min: field.min })}
          {...(field.max !== undefined && { max: field.max })}
        />
      );
    case "select": {
      // Translated Option-Labels kommen aus dem ViewModel-Builder
      // (computeEditViewModel, Convention-Key
      // `<feature>:entity:<entity>:field:<field>:option:<value>`).
      // Wenn keine Translations registriert sind, fallback auf raw
      // value als Label — der ComboboxInput zeigt dann unverändert.
      const rawOptions = field.options ?? [];
      const labels = field.optionLabels;
      const selectOptions =
        labels !== undefined
          ? rawOptions.map((value: string) => ({ value, label: labels[value] ?? value }))
          : rawOptions;
      return (
        <Input
          kind="select"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
          options={selectOptions}
        />
      );
    }
    case "file":
    case "image": {
      const kind = field.type === "image" ? ("image" as const) : ("file" as const);
      const fileId = typeof field.value === "string" && field.value !== "" ? field.value : null;
      return (
        <Input
          kind={kind}
          {...common}
          value={fileId}
          onChange={(v) => onChange(v)}
          {...(field.accept !== undefined && { accept: field.accept })}
          {...(field.maxSize !== undefined && { maxSize: field.maxSize })}
          {...(field.entityType !== undefined && { entityType: field.entityType })}
          {...(field.fieldName !== undefined && { fieldName: field.fieldName })}
          {...(field.imageVariant !== undefined && { imageVariant: field.imageVariant })}
        />
      );
    }
    // embedded (without embeddedListCells — that's embeddedList, which has
    // had its own EmbeddedListField widget since #1838) and jsonb carry
    // arbitrary objects; files/images carry a FileRef-UUID array and have
    // no multi-upload widget yet (deliberately deferred, #1925). Without a
    // dedicated widget these must NOT fall through to a text input:
    // stringValue() turns them into "[object Object]" / a comma-joined
    // string, and saving that overwrites the real data with the mangled
    // string (#1834). A `required: true` on any of these is caught loudly
    // at boot (validateNoWidgetRequiredField in the framework package)
    // instead of silently failing here.
    case "embedded":
    case "jsonb":
    case "files":
    case "images": {
      const hasValue =
        field.value !== undefined && field.value !== null && field.value !== "";
      return (
        <Banner id={id} variant="info">
          {t("kumiko.field.unsupported")}
          {hasValue && <Text variant="code">{JSON.stringify(field.value)}</Text>}
        </Banner>
      );
    }
    default: {
      // text + unknown scalar type → text input. If TextFieldDef.multiline
      // is set (the view-model carries it), the renderer switches to
      // textarea. longText always renders a textarea — that's the point of
      // the type — regardless of whether `multiline` is set; `multiline`
      // only supplies an optional `{ rows }` override for it (#1925).
      if (field.type === "longText" || (field.type === "text" && field.multiline)) {
        const rows = typeof field.multiline === "object" ? field.multiline.rows : undefined;
        return (
          <Input
            kind="textarea"
            {...common}
            value={stringValue(field.value)}
            onChange={(v) => onChange(v)}
            {...(rows !== undefined && { rows })}
          />
        );
      }
      return (
        <Input
          kind="text"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
          {...(field.icon !== undefined && { icon: field.icon })}
        />
      );
    }
  }
}

function stringValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

function numberValue(v: unknown): number | "" {
  if (v === undefined || v === null || v === "") return "";
  return typeof v === "number" ? v : Number(v);
}

// Read/initial value → MoneyInput's minor-units contract. The server's
// read shape is `{amount, currency, amountMinor}` in MAJOR units — deliberately
// NOT reading `amountMinor` here: the server derives it via a flat
// MINOR_UNIT_SCALE=100 (money.ts), which disagrees with currencyDecimals for
// zero-decimal currencies like JPY, so it would double-scale JPY amounts.
// Deriving from `amount * 10**currencyDecimals(currency)` keeps this the
// exact inverse of moneyPayload below. A bare number (e.g. ConfigEditBody's
// stored-config coercion) is MAJOR units too — every producer in this repo
// hands rehydrateMoney's `{amount,…}` shape or a raw major-unit number, never
// pre-scaled minor units.
function moneyMinorValue(v: unknown, currency: string): number | "" {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return Math.round(v * 10 ** currencyDecimals(currency));
  if (typeof v === "object") {
    const amount = (v as { amount?: unknown }).amount;
    if (typeof amount === "number") return Math.round(amount * 10 ** currencyDecimals(currency));
  }
  return "";
}

// MoneyInput's minor-units onChange → the server payload shape
// (`z.object({amount, currency})`, schema-builder.ts) — MAJOR units, no
// `amountMinor` (the server derives that itself on write).
function moneyPayload(minorUnits: number | undefined, currency: string): unknown {
  if (minorUnits === undefined) return undefined;
  return { amount: minorUnits / 10 ** currencyDecimals(currency), currency };
}

// locatedTimestamp-Feldwert: das Read-Wrapper liefert `{ at, tz, utc }`; leer
// (noch nicht gesetzt) → "" als Empty-Sentinel, analog money/timestamp.
function locatedValue(v: unknown): { at: string; tz: string; utc?: string } | "" {
  if (v !== null && typeof v === "object" && "at" in v && "tz" in v) {
    const o = v as { at?: unknown; tz?: unknown; utc?: unknown };
    return {
      at: typeof o.at === "string" ? o.at : "",
      tz: typeof o.tz === "string" ? o.tz : "",
      ...(typeof o.utc === "string" && { utc: o.utc }),
    };
  }
  return "";
}
