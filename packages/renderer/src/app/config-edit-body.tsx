import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigScope,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  ConfigEditScreenDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useCallback, useMemo } from "react";
import {
  QueryOptionLabel,
  resolveOptionsQueryPayload,
} from "../components/query-options-select.tsx";
import { RenderEdit } from "../components/render-edit.tsx";
import { useDispatcher } from "../context/dispatcher-context.tsx";
import type {
  Command,
  DispatcherError,
  FormSnapshot,
  FormValues,
  SubmitResult,
  Translate,
} from "../headless/index.ts";
import { buildOptionLabels, fieldOptionLabelKey } from "../headless/index.ts";
import { useQuery } from "../hooks/use-query.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import {
  buildConfigEditSchema,
  synthesizeConfigEditEntity,
  synthesizeConfigEditScreen,
} from "./config-edit-shim.ts";
import { configEditWithoutSecretFields } from "./config-edit-without-secret-fields.ts";
import { buildInitialValues } from "./entity-edit-prefill.ts";
import type { FeatureSchema } from "./feature-schema.ts";
import { layoutEditFields } from "./layout-fields.ts";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";

// ---- config-edit ----
//
// Settings form against the bundled config feature. On mount it reads
// `config:query:values` (returns ALL keys the user may read as
// `{ [qualifiedKey]: { value, scope } }`); on save it issues one
// `config:write:set` call per changed field. Singleton-per-tenant comes
// by design from the config feature (key+tenantId unique constraint), no
// bridge hack, no extra aggregate.
//
// Built in parallel to ActionFormBody: synthesized entity + entityEdit
// screen so RenderEdit can be reused; layout/field rendering/banner/submit
// button state are identical to entityEdit. The only difference is the
// customSubmit that orchestrates several config:write:set calls.
//
// Since config-seeding the response also contains `source` (e.g.
// "system-row") for the ConfigSourceBadge. The type is kept local because
// it is only relevant here, no separate export needed.
type ConfigValueResponse = Readonly<
  Record<string, { value: string | number | boolean | undefined; scope: string; source: string }>
>;

// A money-typed config-edit field renders through RenderField's entityEdit
// `{amount, currency}` payload shape (render-field.tsx), but
// `ConfigKeyType` (write-helpers.ts validateType) only ever knows
// number/boolean/text/select — a config value is always a bare scalar.
// Unwrap back to the amount before it hits config:write:set.
function unwrapMoneyValue(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "amount" in value) {
    const amount = value.amount;
    if (typeof amount === "number") return amount;
  }
  return value;
}

const CONFIG_SCOPE_SOURCE = {
  user: "user-row",
  tenant: "tenant-row",
  system: "system-row",
} as const satisfies Record<ConfigScope, ConfigCascadeLevel["source"]>;

function isWriteOnlyTextField(
  fieldDef: ConfigEditScreenDefinition["fields"][string] | undefined,
): boolean {
  return fieldDef?.type === "text" && fieldDef.writeOnly === true;
}

function hasStoredValue(stored: unknown): boolean {
  return stored !== undefined && stored !== null && stored !== "";
}

const CONFIG_WRITE_ISSUE_PATH = "value";

// write-helpers report every issue at `value`; in a batch that path is
// meaningless to the form, so point it at the field whose command failed.
function mapFailedConfigCommandIssuesToField(
  error: DispatcherError,
  failedIndex: number,
  commandFieldNames: readonly string[],
): DispatcherError {
  const fieldName = commandFieldNames[failedIndex];
  const fields = error.details?.fields;
  if (fieldName === undefined || fields === undefined) return error;
  return {
    ...error,
    details: {
      ...error.details,
      fields: fields.map((issue) => {
        if (issue.path === CONFIG_WRITE_ISSUE_PATH) return { ...issue, path: fieldName };
        if (issue.path.startsWith(`${CONFIG_WRITE_ISSUE_PATH}.`)) {
          return {
            ...issue,
            path: `${fieldName}${issue.path.slice(CONFIG_WRITE_ISSUE_PATH.length)}`,
          };
        }
        return issue;
      }),
    },
  };
}

// A money field without a declared default starts empty too (buildInitialValues
// maps it to 0, which a save would persist as a deliberate "0" override); numbers
// are handled there, except a required one, which config fields never are.
function buildConfigEditDefaults(
  fields: ConfigEditScreenDefinition["fields"],
): Record<string, unknown> {
  const defaults = buildInitialValues(fields) as Record<string, unknown>; // @cast-boundary render-helper
  for (const [shortName, fieldDef] of Object.entries(fields)) {
    const { type, default: fieldDefault } = fieldDef as { type?: string; default?: unknown }; // @cast-boundary schema-walk
    if ((type === "number" || type === "money") && fieldDefault === undefined) {
      defaults[shortName] = undefined;
    }
  }
  return defaults;
}

type StoredSecretRow = { readonly key: string };

// A field hidden by its `visible` condition (a provider's settings while another
// provider is picked) is not saved: the form saves what it shows.
function hiddenLayoutFieldNames(
  screen: EntityEditScreenDefinition,
  values: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  return new Set(
    layoutEditFields(screen)
      .filter((spec) => spec.visible !== undefined && !evalFieldCondition(spec.visible, values))
      .map((spec) => spec.field),
  );
}

function isEmptyNumericFormValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "number" && !Number.isFinite(value);
}

export function ConfigEditBody({
  schema,
  screen: declaredScreen,
  translate,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ConfigEditScreenDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const { ConfigCascadeView } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const dispatcher = useDispatcher();

  // Detail load: config:query:values returns ALL keys of the tenant.
  // We map them via screen.configKeys from short to qualified name onto our
  // form field values.
  const valuesQuery = useQuery<ConfigValueResponse>("config:query:values", {
    scope: declaredScreen.scope,
  });

  const cascadeQuery = useQuery<Record<string, ConfigCascade>>("config:query:cascade", {
    scope: declaredScreen.scope,
  });

  const secretsQuery = useQuery<readonly StoredSecretRow[]>(
    "secrets:query:list",
    {},
    { enabled: declaredScreen.secretKeys !== undefined },
  );
  // The form screen's access is the union of config and secrets access, so a viewer may write
  // the config keys without being allowed to list secrets: that must not take the form down.
  const secretsDenied = secretsQuery.error?.code === "access_denied";
  const screen = useMemo(
    () => (secretsDenied ? configEditWithoutSecretFields(declaredScreen) : declaredScreen),
    [secretsDenied, declaredScreen],
  );
  const secretKeys = secretsDenied ? undefined : declaredScreen.secretKeys;

  const synthEntity = useMemo(() => synthesizeConfigEditEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeConfigEditScreen(screen), [screen]);
  const boundsSchema = useMemo(() => buildConfigEditSchema(screen.fields), [screen.fields]);

  // Initial values: per field name, fetch the value from `values[qualifiedKey]`.
  // If the key is missing on the server (= never set), we use the field
  // default (createTextField/createNumberField/...).
  // String-coerce only for text fields; other types should already be the
  // native type in the response.
  const initial = useMemo<FormValues | null>(() => {
    if (valuesQuery.data === null) return null;
    if (secretKeys !== undefined && secretsQuery.data === null) return null;
    const storedSecretKeys = new Set((secretsQuery.data ?? []).map((row) => row.key));
    const out: Record<string, unknown> = {};
    const defaults = buildConfigEditDefaults(screen.fields);
    for (const [shortName, fieldDef] of Object.entries(screen.fields)) {
      const secretKey = secretKeys?.[shortName];
      if (secretKey !== undefined) {
        out[shortName] = storedSecretKeys.has(secretKey) ? true : null;
        continue;
      }
      const qualified = screen.configKeys[shortName];
      if (qualified === undefined) {
        // The author declared a field without a mapping: take the default.
        // The boot validator pins this, it should never hit at runtime.
        out[shortName] = defaults[shortName];
        continue;
      }
      const stored = valuesQuery.data[qualified]?.value;
      // The read carries a mask (or nothing); only whether a value exists is
      // meaningful, so the field gets the writeOnly wire shape true / null.
      // The read is the effective value: an inherited one is not "set" on this
      // scope, and a reset here would remove nothing.
      if (isWriteOnlyTextField(fieldDef)) {
        const ownedByThisScope =
          valuesQuery.data[qualified]?.source === CONFIG_SCOPE_SOURCE[screen.scope];
        out[shortName] = ownedByThisScope && hasStoredValue(stored) ? true : null;
        continue;
      }
      if (stored === undefined) {
        out[shortName] = defaults[shortName];
        continue;
      }
      const ftype = propertyOf(fieldDef, "type");
      // Field type coercion: config values are string|number|boolean, but the
      // form state expects the matching native field type.
      if (ftype === "number" || ftype === "money") {
        out[shortName] = typeof stored === "number" ? stored : Number(stored);
      } else if (ftype === "boolean") {
        out[shortName] = typeof stored === "boolean" ? stored : stored === "true";
      } else {
        out[shortName] = typeof stored === "string" ? stored : String(stored);
      }
    }
    return out;
  }, [
    valuesQuery.data,
    secretsQuery.data,
    secretKeys,
    screen.fields,
    screen.configKeys,
    screen.scope,
  ]);

  // Cascade lookup: qualifiedKey -> ConfigCascade for the cascade display
  // under each field. Defensive `levels` shape check so foreign query mocks
  // (e.g. configEdit unit tests that only mock `config:query:values`) do not
  // crash through the cascade rendering.
  const cascades = useMemo<Record<string, ConfigCascade>>(() => {
    if (!cascadeQuery.data) return {};
    const out: Record<string, ConfigCascade> = {};
    for (const [shortName, qualified] of Object.entries(screen.configKeys)) {
      const cascade = cascadeQuery.data[qualified];
      if (cascade && Array.isArray(cascade.levels)) out[shortName] = cascade;
    }
    return out;
  }, [cascadeQuery.data, screen.configKeys]);

  // Multi-write submit: a single /api/batch call with N config:write:set
  // commands. Server-side the batch is atomic (transactional: all writes in
  // one DB tx, all-or-nothing) and browser-side it is exactly one HTTP
  // roundtrip, so there is no race between several in-flight fetches that
  // the browser could abort on a mid-submit page.reload. Promise.all over N
  // separate dispatcher.write calls was fragile: the server receives and
  // commits all N, but the browser connection pool sporadically returns
  // "Failed to fetch" for individual responses, customSubmit returns failure
  // although the write went through, and the form stays dirty.
  const customSubmit = useCallback(
    async (snapshot: FormSnapshot<FormValues>): Promise<SubmitResult<unknown>> => {
      const commands: Command[] = [];
      const commandFieldNames: string[] = [];
      const hiddenFieldNames = hiddenLayoutFieldNames(synthScreen, snapshot.values);
      for (const [shortName, value] of Object.entries(snapshot.changes)) {
        if (hiddenFieldNames.has(shortName)) continue;
        const secretKey = secretKeys?.[shortName];
        if (secretKey !== undefined) {
          // Same wire shape as a writeOnly config field: null removes, a string replaces.
          if (value === null) {
            commandFieldNames.push(shortName);
            commands.push({ type: "secrets:write:delete", payload: { key: secretKey } });
          } else if (typeof value === "string" && value.trim() !== "") {
            commandFieldNames.push(shortName);
            commands.push({ type: "secrets:write:set", payload: { key: secretKey, value } });
          }
          continue;
        }
        const qualified = screen.configKeys[shortName];
        if (qualified === undefined) continue;
        const fieldDef = screen.fields[shortName] as // @cast-boundary schema-walk
          | { type?: string; optionsQuery?: string }
          | undefined;
        const ftype = fieldDef?.type;
        if (isWriteOnlyTextField(screen.fields[shortName])) {
          // true (untouched/undone) and "" mean keep the stored secret; null removes it.
          if (value === null) {
            commandFieldNames.push(shortName);
            commands.push({
              type: "config:write:reset",
              payload: { key: qualified, scope: screen.scope },
            });
          } else if (typeof value === "string" && value !== "") {
            commandFieldNames.push(shortName);
            commands.push({
              type: "config:write:set",
              payload: { key: qualified, value, scope: screen.scope },
            });
          }
          continue;
        }
        // A query-backed select is cleared to "" when its dependent value became
        // invalid. config:write:set would store that as an empty override (the
        // badge shows "Mandant" with no value); reset falls back to the inherited
        // value. set can't do it: deleting the row is irreversible, reset is
        // the high-risk handler.
        if (ftype === "select" && fieldDef?.optionsQuery !== undefined && value === "") {
          commandFieldNames.push(shortName);
          commands.push({
            type: "config:write:reset",
            payload: { key: qualified, scope: screen.scope },
          });
          continue;
        }
        // Cleared number/money: drop this scope's override instead of storing an empty value.
        if (
          (ftype === "number" || ftype === "money") &&
          isEmptyNumericFormValue(ftype === "money" ? unwrapMoneyValue(value) : value)
        ) {
          commandFieldNames.push(shortName);
          commands.push({
            type: "config:write:reset",
            payload: { key: qualified, scope: screen.scope },
          });
          continue;
        }
        commandFieldNames.push(shortName);
        commands.push({
          type: "config:write:set",
          payload: {
            key: qualified,
            value: ftype === "money" ? unwrapMoneyValue(value) : value,
            scope: screen.scope,
          },
        });
      }
      if (commands.length === 0) {
        return { validationBlocked: false, isSuccess: true, data: undefined };
      }
      const result = await dispatcher.batch(commands);
      if (!result.isSuccess) {
        return {
          validationBlocked: false,
          isSuccess: false,
          error: mapFailedConfigCommandIssuesToField(
            result.error,
            result.failedIndex,
            commandFieldNames,
          ),
        };
      }
      // Refresh the cascade disclosure + mask values after the write, otherwise
      // the display stays stale until reload; same refetch calls as onReset.
      // allSettled: the write is already committed, a failed refetch (stale
      // display) must not turn the success result into an error.
      await Promise.allSettled([
        valuesQuery.refetch?.(),
        cascadeQuery.refetch?.(),
        ...(secretKeys !== undefined ? [secretsQuery.refetch?.()] : []),
      ]);
      return { validationBlocked: false, isSuccess: true, data: undefined };
    },
    [
      dispatcher,
      synthScreen,
      secretKeys,
      screen.configKeys,
      screen.fields,
      screen.scope,
      valuesQuery.refetch,
      cascadeQuery.refetch,
      secretsQuery.refetch,
    ],
  );

  if (valuesQuery.loading && valuesQuery.data === null) return <QueryLoadingBanner />;
  const failedQuery = valuesQuery.error
    ? valuesQuery
    : secretsQuery.error && !secretsDenied
      ? secretsQuery
      : null;
  if (failedQuery?.error) {
    return (
      <QueryErrorBanner
        error={failedQuery.error}
        translate={effectiveTranslate}
        onRetry={failedQuery.refetch}
      />
    );
  }
  if (initial === null) return <QueryLoadingBanner />;
  // Cascade values of a select show the option label the select itself shows,
  // not the stored value (a UUID for optionsQuery selects).
  const cascadeValueRenderer = (
    fieldName: string,
  ): ((value: string | number | boolean) => ReactNode) | undefined => {
    const fieldDef = screen.fields[fieldName];
    if (fieldDef?.type !== "select") return undefined;
    if (fieldDef.optionsQuery !== undefined) {
      const query = fieldDef.optionsQuery;
      const payload = resolveOptionsQueryPayload(fieldDef.optionsQueryPayload ?? {}, initial);
      return (value) => <QueryOptionLabel query={query} payload={payload} value={value} />;
    }
    if (fieldDef.options.length === 0) return undefined;
    return (value) =>
      buildOptionLabels(
        effectiveTranslate,
        (option) => fieldOptionLabelKey(schema.featureName, synthScreen.entity, fieldName, option),
        [String(value)],
      )[String(value)];
  };
  return (
    <RenderEdit
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      schema={boundsSchema}
      customSubmit={customSubmit}
      dirtyFooter
      validateOnChange
      {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
      fieldAppendixPlacement="below-control"
      fieldAccent={(fieldName: string) =>
        cascades[fieldName]?.levels.find((level) => level.isActive)?.source ===
        CONFIG_SCOPE_SOURCE[screen.scope]
      }
      markChangedFields
      {...(screen.fieldDescriptions !== undefined && {
        fieldDescription: (fieldName: string) => {
          const key = screen.fieldDescriptions?.[fieldName];
          return key === undefined ? undefined : effectiveTranslate(key);
        },
      })}
      fieldAppendix={(fieldName: string) => {
        const cascade = cascades[fieldName];
        if (cascade === undefined) return undefined;
        const renderValue = cascadeValueRenderer(fieldName);
        return (
          <ConfigCascadeView
            cascade={cascade}
            screenScope={screen.scope}
            qualifiedKey={screen.configKeys[fieldName]}
            required={screen.requiredFields?.includes(fieldName) ?? false}
            {...(renderValue !== undefined && { renderValue })}
            onReset={async (key, scope) => {
              await dispatcher.write("config:write:reset", { key, scope });
              await Promise.allSettled([valuesQuery.refetch?.(), cascadeQuery.refetch?.()]);
            }}
          />
        );
      }}
    />
  );
}
