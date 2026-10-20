import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { rentalTranslations } from "../i18n";
import { LeaseHubHeader, LeaseHubHistory } from "./lease-hub-components";
import { UploadStandardLayout } from "./upload-standard-layout";

export const rentalClient: ClientFeatureDefinition = {
  name: "rental",
  translations: rentalTranslations,
  components: { "upload-standard-layout": UploadStandardLayout },
  extensionSectionComponents: {
    LeaseHubHeader,
    LeaseHubHistory,
  },
};
