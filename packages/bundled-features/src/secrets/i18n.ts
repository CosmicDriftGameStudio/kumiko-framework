import { SECRETS_ERROR_KEYS } from "./web/constants.ts";

export const SECRETS_I18N = {
  [SECRETS_ERROR_KEYS.unknownKey]: {
    en: "Unknown secret key.",
  },
  [SECRETS_ERROR_KEYS.writeDenied]: {
    en: "You are not allowed to change this secret.",
  },
  [SECRETS_ERROR_KEYS.invalidValue]: {
    en: "This value is not valid for this secret.",
  },
} as const;
