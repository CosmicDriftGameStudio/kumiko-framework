// Re-exports — eine Datei pro Entity, Index sammelt sie. So kann
// das Feature später weitere Entities (z.B. tag.ts, comment.ts)
// hinzufügen ohne dass feature.ts oder web/index.ts ihre Imports
// ändern müssen.

export {
  itemActiveScreen,
  itemEditScreen,
  itemEntity,
  itemFeedScreen,
  itemListScreen,
} from "./item";
