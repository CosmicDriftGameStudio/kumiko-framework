import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { SESSIONS_FEATURE } from "../constants.ts";
import { SESSION_DEVICE_CELL_COMPONENT } from "./constants.ts";
import { defaultTranslations } from "./default-translations.ts";
import { SessionDeviceCell } from "./session-device-cell.tsx";

export type SessionsClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function sessionsClient(options?: SessionsClientOptions): ClientFeatureDefinition {
  return {
    name: SESSIONS_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    columnRenderers: { [SESSION_DEVICE_CELL_COMPONENT]: SessionDeviceCell },
  };
}
