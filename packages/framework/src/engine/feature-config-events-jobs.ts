import { ZodObject, type ZodType, type z } from "zod";
import type { FeatureBuilderState } from "./feature-builder-state";
import { resolveName } from "./handler-helpers";
import { splitNamedDefinition, unwrapArrayForm } from "./object-form";
import { QnTypes, qn, toKebab } from "./qualified-name";
import type {
  AuthClaimsFn,
  ClaimKeyHandle,
  ClaimKeyType,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigSeedDef,
  DeclarativeEventMigration,
  EventDef,
  EventPiiFields,
  EventUpcastFn,
  JobDefinition,
  JobHandlerFn,
  MetricOptions,
  NameOrRef,
  NotificationDataFn,
  NotificationRecipientFn,
  NotificationTemplateFn,
  QualifiedEventName,
  SecretKeyHandle,
  SecretOptions,
  TranslationsDef,
} from "./types";

// Builds config/secrets/claims/events/jobs/notifications registrar methods.
export function buildConfigEventsJobsMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
) {
  // Overloaded: (keyName, def) for the single-key case, ({keys, seeds}) for
  // the multi-key case — both funnel through the same qualify/register loop
  // below, so a single-key call is byte-identical to what
  // `{keys:{name:def}}` would have produced.
  function config<T extends ConfigKeyType>(
    keyName: string,
    def: ConfigKeyDefinition<T>,
  ): ConfigKeyHandle<T>;
  function config<
    TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>,
  >(definition: {
    readonly keys: TKeys;
    readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
  }): { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> };
  function config(
    arg1:
      | string
      | {
          readonly keys: Record<string, ConfigKeyDefinition<ConfigKeyType>>;
          readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
        },
    arg2?: ConfigKeyDefinition<ConfigKeyType>,
  ): unknown {
    // arg2 is always defined here — the two public overloads above guarantee
    // it whenever arg1 is a string; the impl signature just has to widen it
    // to optional to satisfy both call shapes.
    const definition = typeof arg1 === "string" && arg2 ? { keys: { [arg1]: arg2 } } : arg1;
    if (typeof definition === "string") {
      throw new Error("config(): single-key form requires a definition as the second argument");
    }
    // Qualify eagerly (same as defineEvent) so the handle name matches what
    // the registry stores — lazy qualification would break compile-time
    // autocomplete and hand-built test registries.
    const handles: Record<string, ConfigKeyHandle<ConfigKeyType>> = {};
    for (const [key, keyDef] of Object.entries(definition.keys)) {
      state.configKeys[key] = keyDef;
      handles[key] = {
        name: qn(toKebab(name), "config", toKebab(key)),
        type: keyDef.type,
      };
    }
    // Parse seeds: resolve qualified key names and validate scope
    if (definition.seeds) {
      for (const [shortKey, seedDef] of Object.entries(definition.seeds)) {
        const keyDef = definition.keys[shortKey];
        if (!keyDef) continue; // skip — boot-validator reports unknown keys
        const qualifiedKey = qn(toKebab(name), "config", toKebab(shortKey));
        const scope = seedDef.scope ?? keyDef.scope;
        state.configSeeds.push({
          key: qualifiedKey,
          value: seedDef.value,
          scope,
          tenantId: seedDef.tenantId,
          userId: seedDef.userId,
        });
      }
    }
    // Single-key call unwraps its own handle; multi-key returns the record.
    return typeof arg1 === "string" ? handles[arg1] : handles;
  }

  // piiFields misconfiguration is a boot-time error, not a silent
  // plaintext leak: both the pii field and its subjectField must exist
  // on the payload schema (checkable when the schema is a ZodObject).
  function validateEventPiiFields(
    eventName: string,
    schema: ZodType,
    piiFields: EventPiiFields,
  ): void {
    const shape = schema instanceof ZodObject ? schema.shape : undefined;
    for (const [field, spec] of Object.entries(piiFields)) {
      if (field === spec.subjectField) {
        throw new Error(
          `[Feature ${name}] defineEvent("${eventName}"): piiFields."${field}" cannot use itself as subjectField — the subject id is a plaintext pseudonymous fk, the pii field is the value it owns.`,
        );
      }
      for (const required of [field, spec.subjectField]) {
        if (shape && !(required in shape)) {
          throw new Error(
            `[Feature ${name}] defineEvent("${eventName}"): piiFields references "${required}" which is not a field of the payload schema.`,
          );
        }
      }
    }
  }

  // Shared by defineEvent's `migrations` option — each entry registers a
  // single upcast step, same validation/dedup as the old standalone
  // r.eventMigration() call (folded into defineEvent, #1082 step 8).
  function registerEventMigration(
    eventName: string,
    fromVersion: number,
    toVersion: number,
    transform: EventUpcastFn | DeclarativeEventMigration,
  ): void {
    if (toVersion !== fromVersion + 1) {
      throw new Error(
        `[Feature ${name}] defineEvent("${eventName}") migrations: only single-step migrations are allowed — toVersion must be fromVersion + 1 (got ${fromVersion} -> ${toVersion}). ` +
          `Chain larger jumps by declaring each step separately.`,
      );
    }
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw new Error(
        `[Feature ${name}] defineEvent("${eventName}") migrations: fromVersion must be >= 1, got ${String(fromVersion)}`,
      );
    }
    const qualified = qn(toKebab(name), "event", toKebab(eventName));
    const list = state.eventMigrations[eventName] ?? [];
    if (list.some((m) => m.fromVersion === fromVersion)) {
      throw new Error(
        `[Feature ${name}] defineEvent("${eventName}") migrations: a migration from v${fromVersion} is already declared. Each step may only be declared once.`,
      );
    }
    const transformFn =
      typeof transform === "function" ? transform : compileEventMigration(transform);
    list.push({ eventName: qualified, fromVersion, toVersion, transform: transformFn });
    state.eventMigrations[eventName] = list;
  }

  return {
    config,
    job(
      jobNameOrDefinition: string | JobDefinition,
      options?: Omit<JobDefinition, "name" | "handler">,
      handler?: JobHandlerFn,
    ): void {
      const [jobName, jobOptions, jobHandler] =
        typeof jobNameOrDefinition === "string"
          ? [
              jobNameOrDefinition,
              options as Omit<JobDefinition, "name" | "handler">,
              handler as JobHandlerFn,
            ]
          : (() => {
              const { name, handler: h, ...rest } = jobNameOrDefinition;
              return [name, rest, h] as const;
            })();
      // Resolve NameOrRef(s) in trigger.on. Multi-Trigger-Form: Array
      // wird zu Array von resolved strings, Single bleibt single string —
      // job-runner unterscheidet anhand Array.isArray.
      const trigger =
        "on" in jobOptions.trigger
          ? {
              on: Array.isArray(jobOptions.trigger.on)
                ? jobOptions.trigger.on.map(resolveName)
                : resolveName(jobOptions.trigger.on as NameOrRef), // @cast-boundary engine-bridge
            }
          : jobOptions.trigger;
      state.jobs[jobName] = { ...jobOptions, trigger, name: jobName, handler: jobHandler };
    },
    notification(
      notificationNameOrDefinition:
        | string
        | ({ readonly name: string } & {
            readonly trigger: { readonly on: NameOrRef };
            readonly recipient: NotificationRecipientFn;
            readonly data: NotificationDataFn;
            readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
          }),
      definition?: {
        readonly trigger: { readonly on: NameOrRef };
        readonly recipient: NotificationRecipientFn;
        readonly data: NotificationDataFn;
        readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
      },
    ): void {
      const [notificationName, resolvedDefinition] =
        typeof notificationNameOrDefinition === "string"
          ? [notificationNameOrDefinition, definition as NonNullable<typeof definition>]
          : splitNamedDefinition(notificationNameOrDefinition);
      state.notifications[notificationName] = {
        name: notificationName,
        trigger: { on: resolveName(resolvedDefinition.trigger.on) },
        recipient: resolvedDefinition.recipient,
        data: resolvedDefinition.data,
        templates: resolvedDefinition.templates,
      };
    },
    translations(def: TranslationsDef): void {
      state.translations = { ...state.translations, ...def.keys };
    },
    defineEvent: <const TInner extends string, TPayload>(
      eventName: TInner,
      schema: ZodType<TPayload>,
      options?: {
        readonly version?: number;
        readonly piiFields?: EventPiiFields;
        // Step-wise upcast chain for this event, folded in from the former
        // standalone r.eventMigration() call (#1082 step 8) — an event and
        // its schema evolution are one lifecycle, not two registrar
        // concepts. Each entry's fromVersion must be unique and the chain
        // from 1 to `version` must be gap-free (same validation as before).
        readonly migrations?: readonly {
          readonly fromVersion: number;
          readonly toVersion: number;
          readonly transform: EventUpcastFn | DeclarativeEventMigration;
        }[];
      },
    ): EventDef<TPayload, QualifiedEventName<TName, TInner>> => {
      // Return the fully-qualified event name so callers can pass it
      // straight to ctx.appendEvent without hand-building the
      // "<feature>:event:<name>" shape. Registry keeps events keyed by
      // short name — qualification is the framework's job, not the feature
      // author's.
      //
      // The runtime kebab-step (`qn(toKebab(feature), …)`) is mirrored at
      // the type-level by `QualifiedEventName<TName, TInner>` so the
      // returned `name` carries the literal qualified shape that the
      // augmented `KumikoEventTypeMap` keys against.
      const qualified = qn(toKebab(name), "event", toKebab(eventName));
      const version = options?.version ?? 1;
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(
          `[Feature ${name}] defineEvent("${eventName}"): version must be a positive integer, got ${String(version)}`,
        );
      }
      const piiFields = options?.piiFields;
      if (piiFields) {
        validateEventPiiFields(eventName, schema, piiFields);
      }
      // @cast-boundary engine-bridge — runtime-string mirrors the
      // template-literal-type via QualifiedEventName + toKebab. Both
      // sides are tested (CamelToKebab type-tests + scan-events kebab
      // tests), so the cast is a contract, not a typing-loss.
      const def: EventDef<TPayload, QualifiedEventName<TName, TInner>> = {
        name: qualified as QualifiedEventName<TName, TInner>,
        schema,
        version,
        ...(piiFields !== undefined && { piiFields }),
      };
      state.events[eventName] = def;
      for (const m of options?.migrations ?? []) {
        registerEventMigration(eventName, m.fromVersion, m.toVersion, m.transform);
      }
      return def;
    },
    readsConfig(
      ...args: readonly [{ readonly keys: readonly string[] }] | readonly string[]
    ): void {
      state.configReads.push(...unwrapArrayForm(args, "keys"));
    },
    metric(
      shortNameOrDefinition: string | ({ readonly name: string } & MetricOptions),
      options?: MetricOptions,
    ): void {
      const [shortName, metricOptions] =
        typeof shortNameOrDefinition === "string"
          ? [shortNameOrDefinition, options as MetricOptions]
          : splitNamedDefinition(shortNameOrDefinition);
      if (state.metrics[shortName]) {
        throw new Error(
          `[Feature ${name}] Metric "${shortName}" already registered. ` +
            `Metric names must be unique per feature.`,
        );
      }
      state.metrics[shortName] = { shortName, ...metricOptions };
    },
    envSchema(schema: z.ZodObject<z.ZodRawShape>): void {
      if (state.envSchema !== undefined) {
        throw new Error(
          `[Feature ${name}] r.envSchema() called twice — declare one composed Zod-object per feature.`,
        );
      }
      state.envSchema = schema;
    },
    secret(
      shortNameOrDefinition: string | ({ readonly name: string } & SecretOptions),
      options?: SecretOptions,
    ): SecretKeyHandle {
      const [shortName, secretOptions] =
        typeof shortNameOrDefinition === "string"
          ? [shortNameOrDefinition, options as SecretOptions]
          : splitNamedDefinition(shortNameOrDefinition);
      if (state.secretKeys[shortName]) {
        throw new Error(
          `[Feature ${name}] Secret "${shortName}" already registered. ` +
            `Secret key names must be unique per feature.`,
        );
      }
      // Qualified name follows the framework's "<feature>:<type>:<name>"
      // QN convention — same pattern config / jobs / events use. toKebab
      // handles the common input shapes ("stripe.apiKey" → "stripe-api-key")
      // so features can declare keys in their natural style without
      // thinking about kebab-case on every call.
      const qualifiedName = qn(toKebab(name), QnTypes.secret, toKebab(shortName));
      state.secretKeys[shortName] = {
        shortName,
        qualifiedName,
        ...secretOptions,
      };
      return { name: qualifiedName };
    },
    claimKey<T extends ClaimKeyType>(
      shortNameOrDefinition: string | { readonly name: string; readonly type: T },
      options?: { readonly type: T },
    ): ClaimKeyHandle<T> {
      const shortName =
        typeof shortNameOrDefinition === "string"
          ? shortNameOrDefinition
          : shortNameOrDefinition.name;
      const claimType: T =
        typeof shortNameOrDefinition === "string"
          ? (options as { readonly type: T }).type
          : shortNameOrDefinition.type;
      if (state.claimKeys[shortName]) {
        throw new Error(
          `[Feature ${name}] Claim key "${shortName}" already declared. ` +
            "Claim short-names must be unique per feature.",
        );
      }
      // Claim keys are NOT full QNs — the JWT shape is 2-segment
      // "<featureName>:<shortName>" (same as Translation keys), not
      // kebab-cased. The authClaims resolver prefixes with the raw
      // feature.name + the raw inner key the hook returns, so the handle's
      // `name` must match that literal string exactly for `readClaim` to
      // find the value. kebab-conversion here would break the round-trip.
      const qualifiedName = `${name}:${shortName}`;
      state.claimKeys[shortName] = {
        shortName,
        qualifiedName,
        type: claimType,
      };
      return { name: qualifiedName, type: claimType };
    },
    authClaims(fn: AuthClaimsFn): void {
      state.authClaimsHooks.push(fn);
    },
  };
}

// Compile the declarative {rename, default, map} migration spec into an
// EventUpcastFn. Fixed order: rename → default → map.
function compileEventMigration(spec: DeclarativeEventMigration): EventUpcastFn {
  // Registration-time (not replay-time) check: two rename sources mapping to
  // the same target would silently drop one value on every future replay —
  // event migrations run against the full production event history, so a
  // typo here must fail loud at defineEvent() registration time, not at replay.
  const renameTargets = new Map<string, string>();
  for (const [from, to] of Object.entries(spec.rename ?? {})) {
    const existing = renameTargets.get(to);
    if (existing !== undefined) {
      throw new Error(
        `Declarative event migration: rename collision — both "${existing}" and "${from}" rename to "${to}". Only one source may map to a given target.`,
      );
    }
    renameTargets.set(to, from);
  }
  return (payload) => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Declarative event migration expects an object payload");
    }
    // @cast-boundary parse — payload is guarded as a plain object above
    const next = { ...(payload as Record<string, unknown>) };
    for (const [from, to] of Object.entries(spec.rename ?? {})) {
      if (from in next) {
        next[to] = next[from];
        delete next[from];
      }
    }
    for (const [key, value] of Object.entries(spec.default ?? {})) {
      if (!(key in next)) next[key] = value;
    }
    for (const [key, fn] of Object.entries(spec.map ?? {})) {
      if (key in next) next[key] = fn(next[key]);
    }
    return next;
  };
}
