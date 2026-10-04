import { SECRETS_ERROR_KEYS } from "./constants.js";

export const SECRETS_I18N = {
  [SECRETS_ERROR_KEYS.unknownKey]: {
    en: "Unknown secret key.",
    de: "Unbekannter Geheimnis-Schlüssel.",
  },
  [SECRETS_ERROR_KEYS.writeDenied]: {
    en: "You are not allowed to change this secret.",
    de: "Dieses Geheimnis darf nicht geändert werden.",
  },
  [SECRETS_ERROR_KEYS.invalidValue]: {
    en: "This value is not valid for this secret.",
    de: "Dieser Wert ist für dieses Geheimnis nicht gültig.",
  },
} as const;
