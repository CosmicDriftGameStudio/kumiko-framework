// Re-exports — one file per entity, the index collects them. That way
// the feature can later add further entities (e.g. tag.ts, comment.ts)
// without feature.ts or web/index.ts having to change
// their imports.

export {
  itemActiveScreen,
  itemEditScreen,
  itemEntity,
  itemFeedScreen,
  itemListScreen,
  itemQuickAddScreen,
} from "./item";
