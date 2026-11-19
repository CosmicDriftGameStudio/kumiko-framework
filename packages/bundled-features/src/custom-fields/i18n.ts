import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { CUSTOM_FIELDS_FEATURE_NAME, CustomFieldsHandlers as H } from "./web/constants.ts";

const UPDATE_TENANT_FIELD = `${CUSTOM_FIELDS_FEATURE_NAME}:write:update-tenant-field`;

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es live in the locale packages.
export const CUSTOM_FIELDS_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.clearCustomField)]: { en: "Clear custom field value" },
  [handlerFieldLabelKey(H.clearCustomField, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(H.clearCustomField, "entityId")]: { en: "Record" },
  [handlerFieldLabelKey(H.clearCustomField, "fieldKey")]: { en: "Field key" },

  [handlerTitleKey(H.defineSystemField)]: { en: "Define system field" },
  [handlerFieldLabelKey(H.defineSystemField, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(H.defineSystemField, "fieldKey")]: { en: "Field key" },
  [handlerFieldLabelKey(H.defineSystemField, "serializedField")]: { en: "Field definition" },
  [handlerFieldLabelKey(H.defineSystemField, "required")]: { en: "Required" },
  [handlerFieldLabelKey(H.defineSystemField, "searchable")]: { en: "Searchable" },
  [handlerFieldLabelKey(H.defineSystemField, "displayOrder")]: { en: "Display order" },
  [handlerFieldLabelKey(H.defineSystemField, "label")]: { en: "Label" },

  [handlerTitleKey(H.defineTenantField)]: { en: "Define custom field" },
  [handlerFieldLabelKey(H.defineTenantField, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(H.defineTenantField, "fieldKey")]: { en: "Field key" },
  [handlerFieldLabelKey(H.defineTenantField, "serializedField")]: { en: "Field definition" },
  [handlerFieldLabelKey(H.defineTenantField, "required")]: { en: "Required" },
  [handlerFieldLabelKey(H.defineTenantField, "searchable")]: { en: "Searchable" },
  [handlerFieldLabelKey(H.defineTenantField, "displayOrder")]: { en: "Display order" },
  [handlerFieldLabelKey(H.defineTenantField, "label")]: { en: "Label" },

  [handlerTitleKey(H.deleteSystemField)]: { en: "Delete system field" },
  [handlerFieldLabelKey(H.deleteSystemField, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(H.deleteSystemField, "fieldKey")]: { en: "Field key" },

  [handlerTitleKey(H.deleteTenantField)]: { en: "Delete custom field" },
  [handlerFieldLabelKey(H.deleteTenantField, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(H.deleteTenantField, "fieldKey")]: { en: "Field key" },

  [handlerTitleKey(H.setCustomField)]: { en: "Set custom field value" },
  [handlerFieldLabelKey(H.setCustomField, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(H.setCustomField, "entityId")]: { en: "Record" },
  [handlerFieldLabelKey(H.setCustomField, "fieldKey")]: { en: "Field key" },
  [handlerFieldLabelKey(H.setCustomField, "value")]: { en: "Value" },

  [handlerTitleKey(UPDATE_TENANT_FIELD)]: { en: "Update custom field" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "entityName")]: { en: "Entity" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "fieldKey")]: { en: "Field key" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "serializedField")]: { en: "Field definition" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "required")]: { en: "Required" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "searchable")]: { en: "Searchable" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "displayOrder")]: { en: "Display order" },
  [handlerFieldLabelKey(UPDATE_TENANT_FIELD, "label")]: { en: "Label" },
};
