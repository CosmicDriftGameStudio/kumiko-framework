import { ZodObject, type ZodType, type z } from "zod";
import type { FeatureBuilderState } from "./feature-builder-state";
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
import { resolveName } from "./types/handlers";

// Builds config/secrets/claims/events/jobs/notifications registrar methods.
export function buildConfigEventsJobsMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
) {
  // Hoisted out of the returned object literal (not just a method) so
  // `configKey()` below can call it directly — object-literal methods
  // aren't in scope for their siblings without a `this`-bind.
  function config<TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>>(definition: {
    readonly keys: TKeys;
    readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
  }): { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> } {
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
    return handles as {
      readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]>;
    }; // @cast-boundary engine-bridge — Mapped-Type-Inference at config()-callsite
  }

  return {
    config,
    // Shorthand for a single key — same handle shape `r.config({keys:{name:def}})`
    // would produce for that key, just without the wrapping record. No seeds
    // param: callers needing seeds use `r.config` directly.
    configKey<T extends ConfigKeyType>(keyName: string, def: ConfigKeyDefinition<T>): ConfigKeyHandle<T> {
      return config({ keys: { [keyName]: def } })[keyName] as ConfigKeyHandle<T>; // @cast-boundary engine-bridge — mapped-type narrows to the single key
    },
    job(
      jobName: string,
      options: Omit<JobDefinition, "name" | "handler">,
      handler: JobHandlerFn,
    ): void {
      // Resolve NameOrRef(s) in trigger.on. Multi-Trigger-Form: Array
      // wird zu Array von resolved strings, Single bleibt single string —
      // job-runner unterscheidet anhand Array.isArray.
      const trigger =
        "on" in options.trigger
          ? {
              on: Array.isArray(options.trigger.on)
                ? options.trigger.on.map(resolveName)
                : resolveName(options.trigger.on as NameOrRef), // @cast-boundary engine-bridge
            }
          : options.trigger;
      state.jobs[jobName] = { ...options, trigger, name: jobName, handler };
    },
    notification(
      notificationName: string,
      definition: {
        readonly trigger: { readonly on: NameOrRef };
        readonly recipient: NotificationRecipientFn;
        readonly data: NotificationDataFn;
        readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
      },
    ): void {
      state.notifications[notificationName] = {
        name: notificationName,
        trigger: { on: resolveName(definition.trigger.on) },
        recipient: definition.recipient,
        data: definition.data,
        templates: definition.templates,
      };
    },
    translations(def: TranslationsDef): void {
      state.translations = { ...state.translations, ...def.keys };
    },
    defineEvent: <const TInner extends string, TPayload>(
      eventName: TInner,
      schema: ZodType<TPayload>,
      options?: { readonly version?: number; readonly piiFields?: EventPiiFields },
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
      // piiFields misconfiguration is a boot-time error, not a silent
      // plaintext leak: both the pii field and its subjectField must exist
      // on the payload schema (checkable when the schema is a ZodObject).
      const piiFields = options?.piiFields;
      if (piiFields) {
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
      return def;
    },
    eventMigration(
      eventName: string,
      fromVersion: number,
      toVersion: number,
      transform: EventUpcastFn | DeclarativeEventMigration,
    ): void {
      if (toVersion !== fromVersion + 1) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ${fromVersion}, ${toVersion}): ` +
            `only single-step migrations are allowed — toVersion must be fromVersion + 1. ` +
            `Chain larger jumps by registering each step separately.`,
        );
      }
      if (!Number.isInteger(fromVersion) || fromVersion < 1) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ...): fromVersion must be >= 1, got ${String(fromVersion)}`,
        );
      }
      const qualified = qn(toKebab(name), "event", toKebab(eventName));
      const list = state.eventMigrations[eventName] ?? [];
      if (list.some((m) => m.fromVersion === fromVersion)) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ${fromVersion}, ${toVersion}): ` +
            `a migration from v${fromVersion} is already registered. Each step may only be declared once.`,
        );
      }
      const transformFn =
        typeof transform === "function" ? transform : compileEventMigration(transform);
      list.push({ eventName: qualified, fromVersion, toVersion, transform: transformFn });
      state.eventMigrations[eventName] = list;
    },
    readsConfig(...qualifiedKeys: string[]): void {
      state.configReads.push(...qualifiedKeys);
    },
    metric(shortName: string, options: MetricOptions): void {
      if (state.metrics[shortName]) {
        throw new Error(
          `[Feature ${name}] Metric "${shortName}" already registered. ` +
            `Metric names must be unique per feature.`,
        );
      }
      state.metrics[shortName] = { shortName, ...options };
    },
    envSchema(schema: z.ZodObject<z.ZodRawShape>): void {
      if (state.envSchema !== undefined) {
        throw new Error(
          `[Feature ${name}] r.envSchema() called twice — declare one composed Zod-object per feature.`,
        );
      }
      state.envSchema = schema;
    },
    secret(shortName: string, options: SecretOptions): SecretKeyHandle {
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
        ...options,
      };
      return { name: qualifiedName };
    },
    claimKey<T extends ClaimKeyType>(
      shortName: string,
      options: { readonly type: T },
    ): ClaimKeyHandle<T> {
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
        type: options.type,
      };
      return { name: qualifiedName, type: options.type };
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
  // typo here must fail loud at r.eventMigration() call time, not at replay.
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
