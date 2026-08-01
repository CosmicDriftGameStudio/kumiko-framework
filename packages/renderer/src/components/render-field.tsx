import type {
  AccessRule,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { EditFieldViewModel, FieldIssue } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useAppFeatures } from "../app/app-features-context";
import { toKebab } from "../app/qn";
import { useUserRoles } from "../context/user-roles-context";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits";
import { useQuery } from "../hooks/use-query";
import { useLocale, useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
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
};

export function RenderField({
  field,
  issues,
  onChange,
  featureName,
  labelAppendix,
  fieldAppendix,
}: RenderFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  // App-Locale (i18n) für money/date-Inputs — sonst fielen sie auf
  // navigator.language (Browser-Sprache) zurück statt der gewählten
  // App-Sprache. BEWUSSTE API-Verschärfung (seit 0.38): RenderField ist
  // public exportiert und verlangt jetzt einen LocaleProvider —
  // Standalone-Consumer/Tests müssen wrappen (createKumikoApp tut es).
  const appLocale = useLocale().locale();
  if (!field.visible) return null;

  const id = inputId(field);
  const hasError = issues !== undefined && issues.length > 0;

  // Reference-Field rendert eine eigene Component — sie nutzt
  // useQuery() für den Live-Lookup, also muss sie als React-
  // Komponente gemountet werden (nicht als pure render-Call).
  const control =
    field.type === "reference" ? (
      <ReferenceInput
        field={field}
        id={id}
        hasError={hasError}
        onChange={onChange}
        Input={Input}
        featureName={featureName ?? ""}
      />
    ) : (
      renderInput({ field, id, hasError, onChange, Input, appLocale })
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

// Duplicated from kumiko-screen.tsx's screenAccessAllows (not imported —
// that module imports RenderEdit → RenderField, importing back from here
// would cycle). Same minimal role-gate logic.
function createScreenAccessAllows(
  access: AccessRule | undefined,
  userRoles: readonly string[] | undefined,
): boolean {
  if (!access) return true;
  if ("openToAll" in access) return access.openToAll;
  if (userRoles === undefined) return false;
  return access.roles.some((role) => userRoles.includes(role));
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
      createScreenAccessAllows(s.access, userRoles),
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
      void queryResult.refetch();
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

// Dispatch auf field.type → Input-Kind. Select threaded options aus dem
// EditFieldViewModel (computeEditViewModel zieht sie aus
// SelectFieldDef.options). Unknown-Types fallen auf text zurück damit
// die Form was Sinnvolles rendert statt blank zu sein.
function renderInput({
  field,
  id,
  hasError,
  onChange,
  Input,
  appLocale,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: ReturnType<typeof usePrimitives>["Input"];
  readonly appLocale: string;
}): ReactNode {
  const common = {
    id,
    name: field.field,
    disabled: field.readOnly,
    required: field.required,
    hasError,
  } as const;

  switch (field.type) {
    case "number":
      return (
        <Input
          kind="number"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
          {...(field.icon !== undefined && { icon: field.icon })}
        />
      );
    case "money": {
      const moneyDef = field as unknown as { currency?: string; locale?: string };
      return (
        <Input
          kind="money"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
          {...(moneyDef.currency !== undefined && { currency: moneyDef.currency })}
          locale={moneyDef.locale ?? appLocale}
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
        />
      );
    }
    default: {
      // text + unknown → text input. Wenn TextFieldDef.multiline gesetzt
      // ist (das ViewModel hält's), wechselt der Renderer auf textarea.
      if (field.type === "text" && field.multiline) {
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
