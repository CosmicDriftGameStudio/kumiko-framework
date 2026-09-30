// @runtime client
// Client-Feature-Factory für custom-fields. Wird vom App-Code in
// createKumikoApp({ clientFeatures: [customFieldsClient()] }) eingehängt
// und registriert die CustomFieldsFormSection unter dem Namen
// CUSTOM_FIELDS_FORM_EXTENSION_NAME im ExtensionSectionsProvider. Apps
// referenzieren den Namen im Screen-Schema:
//
//   layout: { sections: [
//     { kind: "extension", title: "...", contributesToFormSubmit: true, component: {
//       react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME }
//     } },
//   ]}

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { CUSTOM_FIELDS_FEATURE_NAME, CUSTOM_FIELDS_FORM_EXTENSION_NAME } from "../constants.js";
import { CustomFieldsFormSection } from "./custom-fields-form-section.js";
import { defaultTranslations } from "./i18n.js";

export function customFieldsClient(): ClientFeatureDefinition {
  return {
    name: CUSTOM_FIELDS_FEATURE_NAME,
    extensionSectionComponents: {
      [CUSTOM_FIELDS_FORM_EXTENSION_NAME]: CustomFieldsFormSection,
    },
    translations: defaultTranslations,
  };
}
