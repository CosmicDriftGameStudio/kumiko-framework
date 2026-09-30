export {
  DEFAULT_NOTES_HISTORY_ACCESS,
  DEFAULT_NOTES_HISTORY_ROLES,
  NOTES_HISTORY_FEATURE_NAME,
  NOTES_SECTION_EXTENSION_NAME,
  NotesHistoryHandlers,
  NotesHistoryQueries,
} from "./constants.js";
export { noteEntryEntity, noteMentionEntity } from "./entity.js";
export {
  noteEntryExecutor,
  noteEntryTable,
  noteMentionExecutor,
  noteMentionTable,
} from "./executor.js";
export {
  createNotesHistoryFeature,
  type NotesHistoryFeatureOptions,
  notesHistoryFeature,
} from "./feature.js";
export {
  addNoteHandler,
  createAddNoteHandler,
} from "./handlers/add-note.write.js";
export { type AddNotePayload, addNotePayloadSchema } from "./schemas.js";
