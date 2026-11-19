// Pure data (no imports): the web client plugin pivots it into the browser store, and i18n.ts
// spreads it into the server-side bundle.
type Localized = { readonly en: string; readonly de: string };

export const CONNECTOR_FILES_I18N: Readonly<Record<string, Localized>> = {
  "screen:connector-files.title": { en: "Files", de: "Dateien" },
  "connectors.files.root": { en: "All devices", de: "Alle Geräte" },
  "connectors.files.col.name": { en: "Name", de: "Name" },
  "connectors.files.col.type": { en: "Type", de: "Art" },
  "connectors.files.col.files": { en: "Files", de: "Dateien" },
  "connectors.files.col.size": { en: "Size", de: "Größe" },
  "connectors.files.col.received": { en: "Received", de: "Eingang" },
  "connectors.files.kind.device": { en: "Device", de: "Gerät" },
  "connectors.files.kind.folder": { en: "Folder", de: "Ordner" },
  "connectors.files.kind.file": { en: "File", de: "Datei" },
  "connectors.files.storage": { en: "Storage used", de: "Speicher belegt" },
  "connectors.files.storageOf": { en: "of {quota}", de: "von {quota}" },
  "connectors.files.breadcrumb": { en: "Folder path", de: "Ordnerpfad" },
  "connectors.files.storageDeleting": {
    en: "{size} of it is being deleted",
    de: "davon {size} werden gelöscht",
  },
  "connectors.files.empty.title": {
    en: "Nothing delivered here yet",
    de: "Hier ist noch nichts angekommen",
  },
  "connectors.files.empty.hint": {
    en: "Files that a paired satellite delivers appear here.",
    de: "Dateien, die ein gekoppelter Satellit liefert, erscheinen hier.",
  },
  "connectors.files.deleteFile": { en: "Delete", de: "Löschen" },
  "connectors.files.deleteFile.confirm": {
    en: 'Delete the file "{name}"? It is removed from the storage as well. This cannot be undone.',
    de: "Datei „{name}“ löschen? Sie wird auch aus dem Speicher entfernt. Das lässt sich nicht rückgängig machen.",
  },
  "connectors.files.deleteFolder": { en: "Delete folder", de: "Ordner löschen" },
  "connectors.files.deleteFolder.confirm": {
    en: 'Delete the folder "{name}" with {files} ({size})? This cannot be undone.',
    de: "Ordner „{name}“ mit {files} ({size}) löschen? Das lässt sich nicht rückgängig machen.",
  },
  "connectors.files.fileCount.one": { en: "{count} file", de: "{count} Datei" },
  "connectors.files.fileCount.other": { en: "{count} files", de: "{count} Dateien" },
  "connectors.files.deleteFailed": { en: "Deleting failed", de: "Löschen fehlgeschlagen" },
  "connectors.files.more": { en: "More files", de: "Weitere Dateien" },
  "connectors.files.search.placeholder": {
    en: "Search folders and files (at least 2 characters)",
    de: "Ordner und Dateien suchen (mindestens 2 Zeichen)",
  },
  "connectors.files.search.empty": { en: "Nothing found.", de: "Nichts gefunden." },
  "connectors.files.search.truncated": {
    en: "Narrow the search: switch into a folder",
    de: "Suche eingrenzen: in einen Ordner wechseln",
  },
  "connectors.files.col.path": { en: "Path", de: "Pfad" },
  "connectors.files.deleting": { en: "being deleted", de: "wird gelöscht" },
  "connectors.files.first": { en: "Back to the first files", de: "Zurück zu den ersten Dateien" },
};
