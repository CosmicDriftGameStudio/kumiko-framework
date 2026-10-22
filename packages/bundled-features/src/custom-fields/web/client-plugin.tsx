// Registers the custom-fields form section under
// CUSTOM_FIELDS_FORM_EXTENSION_NAME so apps can reference it in their screen schema:
//
//   layout: { sections: [
//     { kind: "extension", title: "...", contributesToFormSubmit: true, component: {
//       react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME }
//     } },
//   ]}

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { CUSTOM_FIELDS_FEATURE_NAME, CUSTOM_FIELDS_FORM_EXTENSION_NAME } from "./constants.ts";
import { CustomFieldsFormSection } from "./custom-fields-form-section.tsx";
import { defaultTranslations } from "./i18n.ts";

export function customFieldsClient(): ClientFeatureDefinition {
  return {
    name: CUSTOM_FIELDS_FEATURE_NAME,
    extensionSectionComponents: {
      [CUSTOM_FIELDS_FORM_EXTENSION_NAME]: CustomFieldsFormSection,
    },
    translations: defaultTranslations,
  };
}
