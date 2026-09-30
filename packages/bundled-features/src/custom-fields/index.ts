export { fieldDefinitionAggregateId } from "./aggregate-id.js";
export {
  CUSTOM_FIELDS_EXTENSION,
  CUSTOM_FIELDS_FEATURE_NAME,
  FIELD_DEFINITION_CREATED_EVENT,
  FIELD_DEFINITION_UPDATED_EVENT,
  SUPPORTED_FIELD_TYPES,
  type SupportedFieldType,
} from "./constants.js";
export { fieldDefinitionEntity } from "./entity.js";
export {
  type CustomFieldClearedPayload,
  type CustomFieldSetPayload,
  customFieldClearedSchema,
  customFieldSetSchema,
} from "./events.js";
export {
  type CustomFieldsFeatureOptions,
  createCustomFieldsFeature,
  customFieldsFeature,
} from "./feature.js";
export {
  type ClearCustomFieldPayload,
  clearCustomFieldPayloadSchema,
} from "./handlers/clear-custom-field.write.js";
export {
  type SetCustomFieldPayload,
  setCustomFieldPayloadSchema,
} from "./handlers/set-custom-field.write.js";
export {
  isFieldDefinitionRow,
  parseSerializedField,
} from "./lib/parse-serialized-field.js";
export {
  type DefineFieldPayload,
  type DeleteFieldPayload,
  defineFieldPayloadSchema,
  deleteFieldPayloadSchema,
} from "./schemas.js";
export { customFieldsField, wireCustomFieldsFor } from "./wire-for-entity.js";
