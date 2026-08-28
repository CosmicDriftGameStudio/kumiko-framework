import {
  type EntityEditScreenDefinition,
  type FieldRenderer,
  isFormatSpec,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  applyFormatSpec,
  currencyDecimals,
  type EditFieldViewModel,
  type FieldIssue,
} from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useAppFeatures } from "../app/app-features-context";
import { useColumnRenderer } from "../app/column-renderers";
import { extensionSectionName } from "../app/extension-sections";
import { toKebab } from "../app/qn";
import { screenAccessAllows } from "../app/screen-access";
import { useUserRoles } from "../context/user-roles-context";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits";
import { useQuery } from "../hooks/use-query";
import { useLocale, useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { EmbeddedListField } from "./embedded-list-field";
import { MultiSelectCheckboxes } from "./multi-select-checkboxes";
import { ReferenceCreateDialog } from "./reference-create-dialog";

// RenderField übersetzt ein EditFieldViewModel → Primitives-Baum.
// Kein raw HTML mehr; alle Darstellungsentscheidungen (Label-Position,
// Fehler-Layout, Input-Styling) leben in der Primitives-Implementation.
//
// Der field.type → Input-kind Mapping bleibt hier, weil es
// Domain-Logik ist (EntityDefinition-Feldtyp) und nicht Darstellung.

// No `hideLabel` prop here (fw#1870/#1871#3, deliberately out of scope):
// RenderField is driven entirely by EditFieldViewModel/EntityEditScreenDefinition,
// which have no per-field hideLabel slot — wiring it through would need a
// schema change, not just a prop. Declarative grid/table screens stay on
// visible labels until that schema work happens; imperative *Field widgets
// (form-fields.tsx, AiTextField) already support it.
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
  /** "form" (default) renders every field as its editable Input, disabled
   *  when `field.readOnly` — unchanged behavior. "text" renders a
   *  `field.readOnly` field as plain text instead (projectionDetail's read
   *  view, fw#2245); editable fields are untouched by this prop either way. */
  readonly valueDisplay?: "form" | "text";
  /** Current form values, keyed by field name — only consulted when
   *  `field.renderer` resolves to a `{ react: { __component } }` registry
   *  component, passed through as `ColumnRendererProps.row` (same contract
   *  as list-column renderers, fw#2245). Omitted → falls back to a
   *  single-key `{ [field.field]: field.value }` row. */
  readonly row?: Readonly<Record<string, unknown>>;
};

export function RenderField({
  field,
  issues,
  onChange,
  featureName,
  labelAppendix,
  fieldAppendix,
  allIssues,
  valueDisplay = "form",
  row,
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
  // An author-declared renderer always wins over the input widget, same as
  // the list-column path (render-list.tsx). Only takes effect once the field
  // is actually readOnly — a FormatSpec/PlatformComponent renderer has no
  // editable widget of its own, so applying it to an editable field would
  // silently make that field un-editable (fw#2245).
  const readOnlyText = valueDisplay === "text" && field.readOnly && field.renderer === undefined;

  // Reference-Field rendert eine eigene Component — sie nutzt
  // useQuery() für den Live-Lookup, also muss sie als React-
  // Komponente gemountet werden (nicht als pure render-Call).
  const control =
    field.readOnly && field.renderer !== undefined ? (
      <FieldRendererOutput
        field={field}
        renderer={field.renderer}
        appLocale={appLocale}
        {...(row !== undefined && { row })}
      />
    ) : field.type === "embedded" && field.embeddedListCells !== undefined ? (
      <EmbeddedListField
        field={field}
        id={id}
        onChange={onChange}
        allIssues={allIssues ?? {}}
        featureName={featureName ?? ""}
      />
    ) : field.type === "reference" ? (
      readOnlyText ? (
        <ReadOnlyReferenceValue field={field} featureName={featureName ?? ""} />
      ) : (
        <ReferenceInput
          field={field}
          id={id}
          hasError={hasError}
          onChange={onChange}
          Input={Input}
          featureName={featureName ?? ""}
        />
      )
    ) : readOnlyText && !isComplexFieldType(field.type) ? (
      <Text testId={`field-value-${field.field}`}>{readOnlyDisplayText(field, appLocale)}</Text>
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

// Doesn't resolve the `string` (cross-feature QN) FieldRenderer variant — the
// list-column path (DataTableCell) doesn't either, so this stays in parity.
function FieldRendererOutput({
  field,
  renderer,
  row,
  appLocale,
}: {
  readonly field: EditFieldViewModel;
  readonly renderer: FieldRenderer;
  readonly row?: Readonly<Record<string, unknown>>;
  readonly appLocale: string;
}): ReactNode {
  const { Text } = usePrimitives();
  const t = useTranslation();
  const componentName =
    !isFormatSpec(renderer) && typeof renderer === "object" && renderer !== null
      ? extensionSectionName(renderer)
      : undefined;
  const Component = useColumnRenderer(componentName);
  if (isFormatSpec(renderer)) {
    // App locale as default when the FormatSpec declares none of its own —
    // otherwise locale-sensitive formats (timestamp/date/number/decimal/
    // bigInt/unit) fell back to Intl's runtime default instead of the app
    // language chosen via LocaleProvider (fw#2187). Prefer renderer.locale
    // when set; coalesce undefined (spread override) back to appLocale (#2332).
    return (
      <Text testId={`field-value-${field.field}`}>
        {applyFormatSpec(
          {
            ...renderer,
            locale: (renderer as { locale?: string }).locale ?? appLocale,
          },
          field.value,
          t,
        )}
      </Text>
    );
  }
  if (componentName !== undefined) {
    if (Component !== undefined) {
      return (
        <Component
          value={field.value}
          row={row ?? { [field.field]: field.value }}
          column={{ field: field.field }}
        />
      );
    }
    // biome-ignore lint/suspicious/noConsole: dev-warning for a registry mismatch, mirrors DataTableCell's columnRenderer warning.
    console.warn(`[kumiko] fieldRenderer "${componentName}" not registered`);
  }
  return <Text testId={`field-value-${field.field}`}>{stringValue(field.value)}</Text>;
}

// Read-only text for `type: "reference"` — resolves the referenced row's
// label via the same lookup query as ReferenceInput's combobox, but shows
// plain text instead of mounting an (unusable, disabled) combobox.
function ReadOnlyReferenceValue({
  field,
  featureName,
}: {
  readonly field: EditFieldViewModel;
  readonly featureName: string;
}): ReactNode {
  const { Text } = usePrimitives();
  const refEntity = field.refEntity ?? "";
  const refFeature = field.refFeature ?? featureName;
  const labelField = field.refLabelField ?? "id";
  const isMultiple = field.refMultiple === true;
  const queryQn = `${toKebab(refFeature)}:query:${toKebab(refEntity)}:list`;
  const queryResult = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(queryQn, {
    limit: REFERENCE_COMBOBOX_LIMIT,
  });
  const ids: readonly string[] = isMultiple
    ? Array.isArray(field.value)
      ? (field.value as readonly string[])
      : []
    : typeof field.value === "string" && field.value !== ""
      ? [field.value]
      : [];
  if (ids.length === 0) return <Text testId={`field-value-${field.field}`}>—</Text>;
  const rows = queryResult.data?.rows ?? [];
  const labels = ids.map((id) => {
    const row = rows.find((r) => String(r["id"] ?? "") === id);
    return row !== undefined ? String(row[labelField] ?? id) : id;
  });
  return <Text testId={`field-value-${field.field}`}>{labels.join(", ")}</Text>;
}

// Field types whose read display already isn't a boxed "disabled input" look
// (embedded/jsonb render as an info Banner, files/images as an unsupported-
// type Banner) — `readOnlyDisplayText` doesn't cover these, they keep going
// through `renderInput`'s existing Banner branch in text-display mode too.
function isComplexFieldType(type: string): boolean {
  return type === "embedded" || type === "jsonb" || type === "files" || type === "images";
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
      if (field.display === "checkboxes") {
        return (
          <MultiSelectCheckboxes
            field={field}
            id={id}
            options={multiSelectOptions}
            value={arrayValue}
            onChange={(v) => onChange(v)}
          />
        );
      }
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
      const currency = resolveMoneyCurrency(field.value, field.currency);
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
          {...(field.capture !== undefined && { capture: field.capture })}
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
      const hasValue = field.value !== undefined && field.value !== null && field.value !== "";
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
function resolveMoneyCurrency(value: unknown, fieldCurrency: string | undefined): string {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { currency?: unknown }).currency === "string"
  ) {
    return (value as { currency: string }).currency;
  }
  return fieldCurrency ?? "EUR";
}

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

// Read-only text for a `field.readOnly` field without its own `renderer` —
// per-type formatting that reuses the same value-shaping helpers as the
// editable widgets above, so a text value and its would-be Input widget stay
// derived from the identical parse (fw#2245). `type: "reference"` isn't
// covered here — it needs a live label lookup, see ReadOnlyReferenceValue.
// `isComplexFieldType` types aren't covered either — callers keep those on
// `renderInput`'s existing Banner fallback.
function readOnlyDisplayText(field: EditFieldViewModel, appLocale: string): string {
  const { type, value } = field;
  if (value === undefined || value === null || value === "") return "—";
  switch (type) {
    case "boolean":
      return applyFormatSpec({ format: "boolean" }, value);
    case "date":
      return applyFormatSpec({ format: "date", locale: field.dateLocale ?? appLocale }, value);
    case "timestamp":
      return applyFormatSpec({ format: "timestamp", locale: field.dateLocale ?? appLocale }, value);
    case "locatedTimestamp": {
      const located = locatedValue(value);
      if (located === "" || located.at === "") return "—";
      return applyFormatSpec(
        { format: "timestamp", locale: field.dateLocale ?? appLocale },
        located.utc ?? located.at,
      );
    }
    case "number":
    case "bigInt":
    case "decimal": {
      const n = numberValue(value);
      return n === "" ? "—" : new Intl.NumberFormat(appLocale).format(n);
    }
    case "money": {
      const currency = resolveMoneyCurrency(value, field.currency);
      const minor = moneyMinorValue(value, currency);
      if (minor === "") return "—";
      const major = minor / 10 ** currencyDecimals(currency);
      return new Intl.NumberFormat(appLocale, { style: "currency", currency }).format(major);
    }
    case "select":
    case "multiSelect": {
      const labels = field.optionLabels;
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) return "—";
      return values
        .map((v) => (typeof v === "string" ? (labels?.[v] ?? v) : stringValue(v)))
        .join(", ");
    }
    case "file":
    case "image":
      return typeof value === "string" ? value : "—";
    default:
      return stringValue(value);
  }
}
