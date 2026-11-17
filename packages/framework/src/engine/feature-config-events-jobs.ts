import type {
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigSeedDef,
  JobDefinition,
  NotificationDataFn,
  NotificationLocalizedTemplate,
  NotificationRecipientFn,
  NotificationRecordMapping,
  NotificationTemplateBody,
  NotificationTemplateFn,
  NotificationTemplateMeta,
  TemplateVariables,
  TranslationsDef,
} from "@cosmicdrift/kumiko-types/config";
import type {
  MetricOptions,
  SecretKeyHandle,
  SecretNamespaceHandle,
  SecretNamespaceOptions,
  SecretOptions,
} from "@cosmicdrift/kumiko-types/feature";
import type {
  AuthClaimsFn,
  ClaimKeyHandle,
  ClaimKeyType,
  DeclarativeEventMigration,
  EventDef,
  EventUpcastFn,
  NameOrRef,
  QualifiedEventName,
} from "@cosmicdrift/kumiko-types/handlers";
import { escapeHatchGrantsProblem } from "@cosmicdrift/kumiko-types/handlers";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type * as z from "zod";
import type { ZodType } from "zod";
import { isValidIanaTimeZone } from "../time/iana.ts";
import { bootRuleError } from "./boot-validator/boot-rule.ts";
import { DEFINITION_CONFIG_EVENTS_JOBS_RULES } from "./boot-validator/definition-config-events-jobs-rules.ts";
import { reasonProblem } from "./escape-hatch-reason.ts";
import { createEventDef } from "./event-def.ts";
import type { FeatureBuilderState } from "./feature-builder-state.ts";
import { resolveName } from "./handler-helpers.ts";
import { QnTypes, qn, toKebab } from "./qualified-name.ts";
import { ANONYMOUS_ROLE, SYSTEM_ROLE } from "./system-user.ts";
import type { EventPiiStance } from "./types/index.ts";

function jobRunAsProblem(runAs: JobDefinition["runAs"]): string | undefined {
  if (runAs === undefined) return undefined;
  if (runAs.roles.length === 0) return "roles is empty; omit runAs instead";
  const reserved = runAs.roles.find((role) => role === SYSTEM_ROLE || role === ANONYMOUS_ROLE);
  if (reserved !== undefined) return `"${reserved}" is reserved and cannot be a job role`;
  return undefined;
}

function assertScheduleTrigger(
  featureName: string,
  jobName: string,
  trigger: JobDefinition["trigger"],
): void {
  if ("maintenance" in trigger && trigger.maintenance !== true) {
    throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobMaintenanceTriggerInvalid, {
      message:
        `[Feature ${featureName}] r.job("${jobName}") declares trigger { maintenance: ${JSON.stringify(trigger.maintenance)} } — ` +
        "the only valid value is true; the run time comes from KUMIKO_MAINTENANCE_WINDOW.",
    });
  }
  if ("wakesSleepingApp" in trigger && trigger.wakesSleepingApp !== undefined) {
    const isScheduled = "cron" in trigger || "maintenance" in trigger;
    if (!isScheduled || trigger.wakesSleepingApp !== false) {
      throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobWakesSleepingAppInvalid, {
        message:
          `[Feature ${featureName}] r.job("${jobName}") declares trigger { wakesSleepingApp: ${JSON.stringify(trigger.wakesSleepingApp)} } — ` +
          "only false is valid, and only on a cron or maintenance trigger; leave it out to wake the app.",
      });
    }
  }
  if ("cron" in trigger && trigger.tz !== undefined && !isValidIanaTimeZone(trigger.tz)) {
    throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobCronTimezoneInvalid, {
      message:
        `[Feature ${featureName}] r.job("${jobName}") declares trigger { cron, tz: ${JSON.stringify(trigger.tz)} } — ` +
        'tz must be an IANA time zone name such as "Europe/Berlin".',
    });
  }
}

// Builds config/secrets/claims/events/jobs/notifications registrar methods.
export function buildConfigEventsJobsMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
) {
  function config<
    TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>,
  >(definition: {
    readonly keys: TKeys;
    readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
  }): { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> };
  function config(definition: {
    readonly keys: Record<string, ConfigKeyDefinition<ConfigKeyType>>;
    readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
  }): unknown {
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
    return handles;
  }

  // Shared by defineEvent's `migrations` option — each entry registers a
  // single upcast step, same validation/dedup as the old standalone
  // r.eventMigration() call (folded into defineEvent).
  function registerEventMigration(
    eventName: string,
    fromVersion: number,
    toVersion: number,
    transform: EventUpcastFn | DeclarativeEventMigration,
  ): void {
    if (toVersion !== fromVersion + 1) {
      throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.eventMigrationStepSize, {
        message:
          `[Feature ${name}] defineEvent("${eventName}") migrations: only single-step migrations are allowed — toVersion must be fromVersion + 1 (got ${fromVersion} -> ${toVersion}). ` +
          `Chain larger jumps by declaring each step separately.`,
      });
    }
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.eventMigrationFromVersionInvalid, {
        message: `[Feature ${name}] defineEvent("${eventName}") migrations: fromVersion must be >= 1, got ${String(fromVersion)}`,
      });
    }
    const qualified = qn(toKebab(name), "event", toKebab(eventName));
    const list = state.eventMigrations[eventName] ?? [];
    if (list.some((m) => m.fromVersion === fromVersion)) {
      throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.eventMigrationDuplicateStep, {
        message: `[Feature ${name}] defineEvent("${eventName}") migrations: a migration from v${fromVersion} is already declared. Each step may only be declared once.`,
      });
    }
    const transformFn =
      typeof transform === "function" ? transform : compileEventMigration(transform);
    list.push({ eventName: qualified, fromVersion, toVersion, transform: transformFn });
    state.eventMigrations[eventName] = list;
  }

  return {
    config,
    job(definition: JobDefinition): void {
      const { name: jobName, handler: jobHandler, ...jobOptions } = definition;
      const jobReasonProblem =
        jobOptions.escapeHatch !== undefined
          ? reasonProblem(jobOptions.escapeHatch.reason)
          : undefined;
      if (jobReasonProblem !== undefined) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobEscapeHatchInvalid, {
          message: `[Feature ${name}] r.job("${jobName}") declares an invalid escapeHatch — ${jobReasonProblem}`,
        });
      }
      const jobGrantsProblem =
        jobOptions.escapeHatch && escapeHatchGrantsProblem(jobOptions.escapeHatch);
      if (jobGrantsProblem) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobEscapeHatchInvalid, {
          message: `[Feature ${name}] r.job("${jobName}") declares an invalid escapeHatch — ${jobGrantsProblem}`,
        });
      }
      const runAsProblem = jobRunAsProblem(jobOptions.runAs);
      if (runAsProblem !== undefined) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobRunAsInvalid, {
          message: `[Feature ${name}] r.job("${jobName}") declares an invalid runAs — ${runAsProblem}`,
        });
      }
      assertScheduleTrigger(name, jobName, jobOptions.trigger);
      // Resolve NameOrRef(s) in trigger.on. For the multi-trigger form, arrays
      // become arrays of resolved strings while a single value remains a string;
      // the job runner distinguishes them with Array.isArray.
      const trigger =
        "on" in jobOptions.trigger
          ? {
              on: Array.isArray(jobOptions.trigger.on)
                ? jobOptions.trigger.on.map(resolveName)
                : resolveName(jobOptions.trigger.on as NameOrRef), // @cast-boundary engine-bridge
              ...(jobOptions.trigger.where !== undefined
                ? { where: jobOptions.trigger.where }
                : {}),
              ...(jobOptions.trigger.catchUp !== undefined
                ? { catchUp: jobOptions.trigger.catchUp }
                : {}),
            }
          : jobOptions.trigger;
      state.jobs[jobName] = { ...jobOptions, trigger, name: jobName, handler: jobHandler };
    },
    notification(
      definition: { readonly name: string } & {
        readonly trigger?: { readonly on: NameOrRef };
        readonly recipient?: NotificationRecipientFn;
        readonly data?: NotificationDataFn;
        readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
        readonly variables?: TemplateVariables;
        readonly record?: NotificationRecordMapping;
        readonly template?: Readonly<Record<string, NotificationTemplateBody>>;
        readonly meta?: Readonly<Record<string, NotificationTemplateMeta>>;
        readonly localizedTemplate?: () => NotificationLocalizedTemplate;
        readonly renamedFrom?: readonly string[];
        readonly systemOnly?: boolean;
        readonly unsubscribe?: boolean;
        readonly tenantTransport?: boolean;
      },
    ): void {
      const { name: notificationName, ...resolvedDefinition } = definition;
      state.notifications[notificationName] = {
        name: notificationName,
        ...(resolvedDefinition.trigger !== undefined
          ? { trigger: { on: resolveName(resolvedDefinition.trigger.on) } }
          : {}),
        ...(resolvedDefinition.recipient !== undefined
          ? { recipient: resolvedDefinition.recipient }
          : {}),
        ...(resolvedDefinition.data !== undefined ? { data: resolvedDefinition.data } : {}),
        templates: resolvedDefinition.templates,
        ...(resolvedDefinition.variables !== undefined
          ? { variables: resolvedDefinition.variables }
          : {}),
        ...(resolvedDefinition.record !== undefined ? { record: resolvedDefinition.record } : {}),
        ...(resolvedDefinition.template !== undefined
          ? { template: resolvedDefinition.template }
          : {}),
        ...(resolvedDefinition.meta !== undefined ? { meta: resolvedDefinition.meta } : {}),
        ...(resolvedDefinition.localizedTemplate !== undefined
          ? { localizedTemplate: resolvedDefinition.localizedTemplate }
          : {}),
        ...(resolvedDefinition.renamedFrom !== undefined
          ? { renamedFrom: resolvedDefinition.renamedFrom }
          : {}),
        ...(resolvedDefinition.systemOnly === true ? { systemOnly: true } : {}),
        ...(resolvedDefinition.unsubscribe === true ? { unsubscribe: true } : {}),
        ...(resolvedDefinition.tenantTransport === true ? { tenantTransport: true } : {}),
      };
    },
    translations(def: TranslationsDef): void {
      state.translations = { ...state.translations, ...def.keys };
    },
    defineEvent: <const TInner extends string, TPayload>(
      eventName: TInner,
      schema: ZodType<TPayload>,
      options: {
        readonly version?: number;
        readonly piiFields: EventPiiStance;
        // Step-wise upcast chain for this event, folded in from the former
        // standalone r.eventMigration() call — an event and
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
      const def = createEventDef({
        feature: name,
        name: eventName,
        schema,
        piiFields: options?.piiFields,
        ...(options?.version !== undefined ? { version: options.version } : {}),
      });
      state.events[eventName] = def;
      for (const m of options.migrations ?? []) {
        registerEventMigration(eventName, m.fromVersion, m.toVersion, m.transform);
      }
      return def;
    },
    readsConfig(options: { readonly keys: readonly string[] }): void {
      state.configReads.push(...options.keys);
    },
    metric(definition: { readonly name: string } & MetricOptions): void {
      const { name: shortName, ...metricOptions } = definition;
      if (state.metrics[shortName]) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.metricDuplicate, {
          message:
            `[Feature ${name}] Metric "${shortName}" already registered. ` +
            `Metric names must be unique per feature.`,
        });
      }
      state.metrics[shortName] = { shortName, ...metricOptions };
    },
    // guard:dup-ok builder setter shape, sharing would add a parameter per line
    envSchema(schema: z.ZodObject<z.ZodRawShape>): void {
      if (state.envSchema !== undefined) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.envSchemaTwice, {
          message: `[Feature ${name}] r.envSchema() called twice — declare one composed Zod-object per feature.`,
        });
      }
      state.envSchema = schema;
    },
    secret(definition: { readonly name: string } & SecretOptions): SecretKeyHandle {
      const { name: shortName, ...secretOptions } = definition;
      if (state.secretKeys[shortName]) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.secretDuplicate, {
          message:
            `[Feature ${name}] Secret "${shortName}" already registered. ` +
            `Secret key names must be unique per feature.`,
        });
      }
      if (secretOptions.writeRoles !== undefined && secretOptions.writeRoles.length === 0) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.secretWriteRolesEmpty, {
          message:
            `[Feature ${name}] Secret "${shortName}" declares an empty writeRoles list, ` +
            `which nobody could ever satisfy. Omit writeRoles to fall back to the secrets handler access.`,
        });
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
    secretNamespace(
      definition: { readonly name: string } & SecretNamespaceOptions,
    ): SecretNamespaceHandle {
      const { name: shortName, ...namespaceOptions } = definition;
      if (state.secretNamespaces[shortName]) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.secretNamespaceDuplicate, {
          message:
            `[Feature ${name}] Secret namespace "${shortName}" already registered. ` +
            `Secret namespace names must be unique per feature.`,
        });
      }
      if (namespaceOptions.writeRoles !== undefined && namespaceOptions.writeRoles.length === 0) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.secretWriteRolesEmpty, {
          message:
            `[Feature ${name}] Secret namespace "${shortName}" declares an empty writeRoles list, ` +
            `which nobody could ever satisfy. Omit writeRoles to fall back to the secrets handler access.`,
        });
      }
      const qualifiedPrefix = `${toKebab(name)}:${toKebab(shortName)}.`;
      state.secretNamespaces[shortName] = { shortName, qualifiedPrefix, ...namespaceOptions };
      return { prefix: qualifiedPrefix, keyFor: (suffix) => `${qualifiedPrefix}${suffix}` };
    },
    claimKey<T extends ClaimKeyType>(definition: {
      readonly name: string;
      readonly type: T;
    }): ClaimKeyHandle<T> {
      const { name: shortName, type: claimType } = definition;
      if (state.claimKeys[shortName]) {
        throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.claimKeyDuplicate, {
          message:
            `[Feature ${name}] Claim key "${shortName}" already declared. ` +
            "Claim short-names must be unique per feature.",
        });
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
      throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.eventMigrationRenameCollision, {
        message: `Declarative event migration: rename collision — both "${existing}" and "${from}" rename to "${to}". Only one source may map to a given target.`,
      });
    }
    renameTargets.set(to, from);
  }
  return (payload) => {
    if (!isPlainObject(payload)) {
      throw new Error("Declarative event migration expects an object payload");
    }
    const next = { ...payload };
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
