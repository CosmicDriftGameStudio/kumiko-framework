import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { rentalTranslations } from "../i18n";
import { LeaseHubHeader, LeaseHubHistory } from "./lease-hub-components";

export const rentalClient: ClientFeatureDefinition = {
  name: "rental",
  translations: rentalTranslations,
  extensionSectionComponents: {
    LeaseHubHeader,
    LeaseHubHistory,
  },
};
