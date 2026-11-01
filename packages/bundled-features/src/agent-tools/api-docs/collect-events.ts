import {
  createWebhookContractResolver,
  type WebhookEventContract,
  webhookEventDescriptionKey,
  webhookEventFieldKey,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { PatScopeConfig } from "../../personal-access-tokens/index.ts";
import {
  compareIds,
  entityFieldLabels,
  localizedLabels,
  localizedLabelsForSuffix,
  pickLabel,
} from "../labels.ts";
import type { RegistryManifestView } from "../types.ts";
import type { WebhookExampleFile } from "./examples.ts";
import type { ApiDocsEvent, LocalizedText } from "./model.ts";
import { fieldRows } from "./schema-fields.ts";

const SOURCE_LOCALE = "en";

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

function perLocale(locales: readonly string[], resolve: (locale: string) => string): LocalizedText {
  return Object.fromEntries(locales.map((locale) => [locale, resolve(locale)]));
}

/** `undefined` when the payload cannot be expressed as JSON Schema (transforms, instanceof, ...). */
function payloadJsonSchema(contract: WebhookEventContract): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(contract.payload, { io: "output" });
  } catch {
    // skip: a payload without a JSON Schema form is documented without a field table
    return undefined;
  }
}

/** Declared contracts read `<feature>:webhook:<name>:field:<path>`, derived ones the entity's
 *  field labels. A row without a label keeps the schema description (`.describe()`). */
function fieldLabelsByRow(
  translations: ReturnType<RegistryManifestView["getAllTranslations"]>,
  contract: WebhookEventContract,
  payloadSchema: Record<string, unknown> | undefined,
  locales: readonly string[],
): Readonly<Record<string, LocalizedText>> {
  const { entity } = contract;
  return Object.fromEntries(
    fieldRows(payloadSchema).flatMap(({ name }) => {
      const labels =
        entity === undefined
          ? localizedLabels(translations, webhookEventFieldKey(contract.qn, name))
          : entityFieldLabels(translations, entity, name);
      const resolved = Object.fromEntries(
        locales.flatMap((locale) => {
          // A declared field falls back to its English `.describe()`, never to another locale.
          const label =
            entity === undefined
              ? (nonEmpty(labels[locale]) ?? nonEmpty(labels[SOURCE_LOCALE]))
              : pickLabel(labels, locale);
          return label === undefined ? [] : [[locale, label]];
        }),
      );
      return [[name, resolved]];
    }),
  );
}

function buildEvent(
  registry: RegistryManifestView,
  contract: WebhookEventContract,
  domains: readonly string[],
  options: { locales: readonly string[]; examples: ReadonlyMap<string, WebhookExampleFile> },
): ApiDocsEvent {
  const translations = registry.getAllTranslations();
  const { locales } = options;
  const declared = contract.origin === "declared";
  const descriptionLabels = declared
    ? localizedLabels(translations, webhookEventDescriptionKey(contract.qn))
    : {};
  const entityLabels =
    contract.entity === undefined
      ? {}
      : localizedLabelsForSuffix(translations, `:entity:${contract.entity}`);
  const payloadSchema = payloadJsonSchema(contract);
  return {
    qn: contract.qn,
    origin: contract.origin,
    ...(contract.entity !== undefined && { entity: contract.entity }),
    ...(contract.verb !== undefined && { verb: contract.verb }),
    version: contract.version,
    description: perLocale(
      locales,
      (locale) =>
        nonEmpty(descriptionLabels[locale]) ??
        nonEmpty(descriptionLabels[SOURCE_LOCALE]) ??
        contract.description,
    ),
    entityLabel: perLocale(
      locales,
      (locale) => pickLabel(entityLabels, locale) ?? contract.entity ?? contract.qn,
    ),
    untranslatedLocales: declared
      ? locales.filter(
          (locale) => locale !== SOURCE_LOCALE && nonEmpty(descriptionLabels[locale]) === undefined,
        )
      : [],
    fieldLabels: fieldLabelsByRow(translations, contract, payloadSchema, locales),
    payloadSchema,
    domains,
    example: options.examples.get(contract.qn),
  };
}

/** Events some scope lists, deduplicated and sorted by QN. An entry without a contract is
 *  skipped: the token feature's boot check already refuses to start with one. */
export function collectApiDocsEvents(
  registry: RegistryManifestView,
  scopes: PatScopeConfig,
  options: { locales: readonly string[]; examples: ReadonlyMap<string, WebhookExampleFile> },
): readonly ApiDocsEvent[] {
  const domainsByEvent = new Map<string, string[]>();
  for (const domain of Object.keys(scopes).sort(compareIds)) {
    for (const qn of scopes[domain]?.events ?? []) {
      const domains = domainsByEvent.get(qn) ?? [];
      if (!domains.includes(domain)) domains.push(domain);
      domainsByEvent.set(qn, domains);
    }
  }
  const resolver = createWebhookContractResolver([...registry.features.values()]);
  return [...domainsByEvent.keys()].sort(compareIds).flatMap((qn) => {
    const contract = resolver.get(qn);
    return contract === undefined
      ? []
      : [buildEvent(registry, contract, domainsByEvent.get(qn) ?? [], options)];
  });
}
