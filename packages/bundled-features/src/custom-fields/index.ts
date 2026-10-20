export { fieldDefinitionAggregateId } from "./aggregate-id.ts";
export { fieldDefinitionEntity } from "./entity.ts";
export {
  type CustomFieldClearedPayload,
  type CustomFieldSetPayload,
  customFieldClearedSchema,
  customFieldSetSchema,
} from "./events.ts";
export {
  type CustomFieldsFeatureOptions,
  createCustomFieldsFeature,
} from "./feature.ts";
export {
  type ClearCustomFieldPayload,
  clearCustomFieldPayloadSchema,
} from "./handlers/clear-custom-field.write.ts";
export {
  type SetCustomFieldPayload,
  setCustomFieldPayloadSchema,
} from "./handlers/set-custom-field.write.ts";
export {
  isFieldDefinitionRow,
  parseSerializedField,
} from "./lib/parse-serialized-field.ts";
export {
  type DefineFieldPayload,
  type DeleteFieldPayload,
  defineFieldPayloadSchema,
  deleteFieldPayloadSchema,
} from "./schemas.ts";
export {
  CUSTOM_FIELDS_EXTENSION,
  CUSTOM_FIELDS_FEATURE_NAME,
  FIELD_DEFINITION_CREATED_EVENT,
  FIELD_DEFINITION_UPDATED_EVENT,
  SUPPORTED_FIELD_TYPES,
  type SupportedFieldType,
} from "./web/constants.ts";
export { customFieldsField, wireCustomFieldsFor } from "./wire-for-entity.ts";
