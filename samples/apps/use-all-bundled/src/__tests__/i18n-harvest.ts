// Reads English copy from the real registrations, so parity cannot drift from a hand-kept key list.

import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import type { TranslationValue } from "@cosmicdrift/kumiko-framework/ui-types";
import { kumikoDefaultTranslations } from "@cosmicdrift/kumiko-renderer";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { AUTH_MAIL_EN } from "../../../../../packages/bundled-features/src/auth-email-password/email-templates";
import { GDPR_MAIL_EN } from "../../../../../packages/bundled-features/src/user-data-rights/email-templates";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS } from "../run-config";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_FEATURES_SRC = join(HERE, "../../../../../packages/bundled-features/src");

// Features of this sample, not of the framework: their copy is app-owned.
const SAMPLE_OWNED_FEATURES: ReadonlySet<string> = new Set([
  "cap-overview-labels",
  "collection-labels",
  "locale-de",
]);

// Keys an app supplies itself because they depend on app config, not on the
// framework: personal-access-token scope options are generated from the
// scopes each app passes to createPersonalAccessTokensFeature.
const APP_SUPPLIED_KEY_PATTERNS: readonly RegExp[] = [
  /^personal-access-tokens:entity:__action-form__:field:scopes:option:/,
];

export function isAppSuppliedKey(key: string): boolean {
  return APP_SUPPLIED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export type EnHarvest = {
  readonly en: Readonly<Record<string, TranslationValue>>;
  readonly conflicts: readonly string[];
  readonly entryCountByOrigin: Readonly<Record<string, number>>;
};

function isZeroArgFactory(value: unknown): value is () => unknown {
  return typeof value === "function";
}

function enOfClientPlugin(plugin: unknown): Readonly<Record<string, TranslationValue>> {
  if (typeof plugin !== "object" || plugin === null || !("translations" in plugin)) return {};
  const { translations } = plugin;
  if (typeof translations !== "object" || translations === null || !("en" in translations)) {
    return {};
  }
  const { en } = translations;
  return typeof en === "object" && en !== null ? { ...en } : {};
}

type HarvestSource = {
  readonly origin: string;
  readonly entries: readonly (readonly [string, TranslationValue])[];
};

async function harvestClientPlugins(): Promise<readonly HarvestSource[]> {
  const out: HarvestSource[] = [];
  for (const dirName of readdirSync(BUNDLED_FEATURES_SRC)) {
    const webIndex = join(BUNDLED_FEATURES_SRC, dirName, "web", "index.ts");
    if (!statSync(webIndex, { throwIfNoEntry: false })?.isFile()) continue;
    const mod: Record<string, unknown> = await import(webIndex);
    for (const [exportName, factory] of Object.entries(mod)) {
      if (!exportName.endsWith("Client") || !isZeroArgFactory(factory)) continue;
      out.push({
        origin: `client:${dirName}`,
        entries: Object.entries(enOfClientPlugin(factory())),
      });
    }
  }
  return out;
}

export async function harvestEnglish(): Promise<EnHarvest> {
  const features = composeFeatures([...APP_FEATURES], {
    includeBundled: true,
    authOptions: AUTH_COMPOSE_OPTIONS,
  });
  const schema = buildAppSchema(createRegistry(features));

  const sources: HarvestSource[] = [];
  for (const feature of schema.features) {
    if (SAMPLE_OWNED_FEATURES.has(feature.featureName)) continue;
    const entries: [string, TranslationValue][] = [];
    for (const [key, byLocale] of Object.entries(feature.translations ?? {})) {
      const en = byLocale["en"];
      if (en !== undefined) entries.push([key, en]);
    }
    sources.push({ origin: `server:${feature.featureName}`, entries });
  }
  sources.push(...(await harvestClientPlugins()));
  sources.push({
    origin: "renderer",
    entries: Object.entries(kumikoDefaultTranslations["en"] ?? {}),
  });
  sources.push({ origin: "mail:auth", entries: Object.entries(AUTH_MAIL_EN) });
  sources.push({ origin: "mail:gdpr", entries: Object.entries(GDPR_MAIL_EN) });

  const entryCountByOrigin: Record<string, number> = {};
  for (const { origin, entries } of sources) {
    entryCountByOrigin[origin] = (entryCountByOrigin[origin] ?? 0) + entries.length;
  }

  const en: Record<string, TranslationValue> = {};
  const firstOrigin = new Map<string, string>();
  const conflicts: string[] = [];
  for (const { origin, entries } of sources) {
    for (const [key, value] of entries) {
      if (isAppSuppliedKey(key)) continue;
      const existing = en[key];
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
        conflicts.push(
          `${key}: ${firstOrigin.get(key)} = ${JSON.stringify(existing)} vs ${origin} = ${JSON.stringify(value)}`,
        );
        continue;
      }
      en[key] = value;
      if (!firstOrigin.has(key)) firstOrigin.set(key, origin);
    }
  }
  return { en, conflicts, entryCountByOrigin };
}
