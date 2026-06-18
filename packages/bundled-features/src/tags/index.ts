export { tagAssignmentAggregateId } from "./aggregate-id";
export {
  DEFAULT_TAG_ROLES,
  TAGS_FEATURE_NAME,
  TagsHandlers,
  TagsQueries,
} from "./constants";
export { tagAssignmentEntity, tagEntity } from "./entity";
export { createTagsFeature, type TagsFeatureOptions, tagsFeature } from "./feature";
export {
  assignTagHandler,
  createAssignTagHandler,
} from "./handlers/assign-tag.write";
export {
  createCreateTagHandler,
  createTagHandler,
} from "./handlers/create-tag.write";
export {
  createRemoveTagHandler,
  removeTagHandler,
} from "./handlers/remove-tag.write";
export {
  type AssignTagPayload,
  assignTagPayloadSchema,
  type CreateTagPayload,
  createTagPayloadSchema,
  type RemoveTagPayload,
  removeTagPayloadSchema,
} from "./schemas";
