import { patAllows } from "@cosmicdrift/kumiko-framework/api";
import type {
  FeatureDefinition,
  QueryHandlerDef,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  handlerDescriptionKey,
  handlerFieldLabelKey,
  handlerTitleKey,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  expandScopes,
  type PatScopeConfig,
  patRateLimitFromFeature,
  patScopesFromFeature,
} from "../../personal-access-tokens/index.ts";
import { handlerInputJsonSchema } from "../handler-schema.ts";
import { compareIds, entityFieldLabels, localizedLabels, pickLabel } from "../labels.ts";
import type { RegistryManifestView } from "../types.ts";
import { collectApiDocsEvents } from "./collect-events.ts";
import type { ApiExampleFile, WebhookExampleFile } from "./examples.ts";
import { patCreateLabel, patMenuPath } from "./menu-path.ts";
import type {
  ApiDocsGrantLevel,
  ApiDocsHandler,
  ApiDocsModel,
  ApiDocsScope,
  ApiDocsScopeHandler,
  LocalizedText,
} from "./model.ts";
import { fieldRows } from "./schema-fields.ts";
import { isSystemOnlyHandler } from "./system-only.ts";

export function findPatFeature(registry: RegistryManifestView): FeatureDefinition | undefined {
  return [...registry.features.values()].find(
    (feature) => patScopesFromFeature(feature) !== undefined,
  );
}

type AnyHandlerDef = QueryHandlerDef | WriteHandlerDef;

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

function perLocale(
  locales: readonly string[],
  resolve: (locale: string) => string | undefined,
): LocalizedText {
  return Object.fromEntries(
    locales.flatMap((locale) => {
      const text = resolve(locale);
      return text === undefined ? [] : [[locale, text]];
    }),
  );
}

function buildHandler(
  registry: RegistryManifestView,
  qn: string,
  def: AnyHandlerDef,
  kind: "query" | "write",
  locales: readonly string[],
  examples: ReadonlyMap<string, ApiExampleFile>,
): ApiDocsHandler {
  const translations = registry.getAllTranslations();
  const titleLabels = localizedLabels(translations, handlerTitleKey(qn));
  const descriptionLabels = localizedLabels(translations, handlerDescriptionKey(qn));
  const fallbackDescription = nonEmpty(def.description);
  const inputSchema = handlerInputJsonSchema(def);
  const entity = registry.getHandlerEntity(qn);
  const fieldLabels = Object.fromEntries(
    fieldRows(inputSchema).map(({ name: field }) => {
      const own = localizedLabels(translations, handlerFieldLabelKey(qn, field));
      const labels =
        Object.keys(own).length > 0 || entity === undefined
          ? own
          : entityFieldLabels(translations, entity, field);
      return [field, perLocale(locales, (locale) => pickLabel(labels, locale))];
    }),
  );
  return {
    qn,
    kind,
    title: perLocale(
      locales,
      (locale) => pickLabel(titleLabels, locale) ?? fallbackDescription ?? qn,
    ),
    description: perLocale(
      locales,
      (locale) => nonEmpty(descriptionLabels[locale]) ?? fallbackDescription,
    ),
    inputSchema,
    excludedFields: "excludedFields" in def && def.excludedFields ? [...def.excludedFields] : [],
    fieldLabels,
    example: examples.get(qn),
  };
}

function scopeHandlers(
  domain: string,
  scopes: PatScopeConfig,
  qns: readonly string[],
): readonly ApiDocsScopeHandler[] {
  const readQns = expandScopes(scopes, [`${domain}:read`]);
  const writeQns = expandScopes(scopes, [`${domain}:write`]);
  return qns.flatMap((qn) => {
    const grant: ApiDocsGrantLevel | undefined = patAllows(readQns, qn)
      ? "read"
      : patAllows(writeQns, qn)
        ? "write"
        : undefined;
    return grant === undefined ? [] : [{ qn, grant }];
  });
}

/** Registry and PAT scope catalog to a locale-resolved model. Only handlers that
 *  some scope reaches are collected, so nothing outside the scopes can leak into the docs. */
export function collectApiDocsModel(
  registry: RegistryManifestView,
  options: {
    readonly locales: readonly string[];
    readonly examples: ReadonlyMap<string, ApiExampleFile>;
    readonly webhookExamples: ReadonlyMap<string, WebhookExampleFile>;
  },
): { readonly model: ApiDocsModel; readonly patFeature: FeatureDefinition } | undefined {
  const patFeature = findPatFeature(registry);
  const scopeConfig = patFeature === undefined ? undefined : patScopesFromFeature(patFeature);
  if (patFeature === undefined || scopeConfig === undefined) return undefined;

  const kinds = new Map<string, { kind: "query" | "write"; def: AnyHandlerDef }>();
  for (const [qn, def] of registry.getAllQueryHandlers()) {
    if (!isSystemOnlyHandler(def)) kinds.set(qn, { kind: "query", def });
  }
  for (const [qn, def] of registry.getAllWriteHandlers()) {
    if (!isSystemOnlyHandler(def)) kinds.set(qn, { kind: "write", def });
  }
  const allQns = [...kinds.keys()].sort(compareIds);

  const scopes: ApiDocsScope[] = Object.keys(scopeConfig)
    .sort(compareIds)
    .map((domain) => ({
      domain,
      label: scopeConfig[domain]?.label ?? domain,
      hasWriteLevel: (scopeConfig[domain]?.write?.length ?? 0) > 0,
      handlers: scopeHandlers(domain, scopeConfig, allQns),
    }));

  const reachable = new Set(scopes.flatMap((scope) => scope.handlers.map((entry) => entry.qn)));
  const handlers = allQns
    .filter((qn) => reachable.has(qn))
    .flatMap((qn) => {
      const entry = kinds.get(qn);
      return entry === undefined
        ? []
        : [buildHandler(registry, qn, entry.def, entry.kind, options.locales, options.examples)];
    });

  return {
    patFeature,
    model: {
      scopes,
      events: collectApiDocsEvents(registry, scopeConfig, {
        locales: options.locales,
        examples: options.webhookExamples,
      }),
      handlers,
      menuPath: patMenuPath(registry, patFeature, options.locales),
      createLabel: patCreateLabel(registry, patFeature, options.locales),
      rateLimit: patRateLimitFromFeature(patFeature),
      toggleable: patFeature.toggleableDefault !== undefined,
    },
  };
}
