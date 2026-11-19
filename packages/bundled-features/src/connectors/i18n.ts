import { CONNECTOR_FILES_I18N } from "./files-i18n.ts";
import { CONNECTOR_STATUS_OPTION_KEY_PREFIX, connectorFieldLabelKey } from "./screens.ts";

type Localized = { readonly en: string; readonly de: string };

export const CONNECTORS_I18N: Readonly<Record<string, Localized>> = {
  ...CONNECTOR_FILES_I18N,
  "errors.connectors.invalidUserCode": {
    en: "No pairing attempt with this code. Start the satellite and enter the code it shows right now.",
    de: "Kein Kopplungsversuch mit diesem Code. Starte den Satelliten und gib den Code ein, den er gerade anzeigt.",
  },
  "errors.connectors.connectorRevoked": {
    en: "This connector was revoked.",
    de: "Dieser Anschluss wurde widerrufen.",
  },
  "errors.connectors.uploadNotPrepared": {
    en: "The file could not be stored.",
    de: "Die Datei konnte nicht gespeichert werden.",
  },

  "errors.connectors.storageQuotaExceeded": {
    en: "The storage quota of this account is used up.",
    de: "Das Speicherkontingent dieses Kontos ist aufgebraucht.",
  },

  "connectors.list.col.sync": { en: "Sync", de: "Sync" },
  "connectors.list.col.syncDetail": { en: "Details", de: "Details" },
  "connectors.list.sync.status.unknown": { en: "Unknown", de: "Unbekannt" },
  "connectors.list.sync.status.synced": { en: "In sync", de: "Synchron" },
  "connectors.list.sync.status.syncing": { en: "Running", de: "Läuft" },
  "connectors.list.sync.status.failed": { en: "Failed", de: "Fehler" },
  "connectors.list.sync.queued": { en: "{count} in the queue", de: "{count} in der Warteschlange" },
  "connectors.list.sync.failedCount": { en: "{count} failed", de: "{count} Fehler" },
  "connectors.list.retry": { en: "Retry", de: "Erneut versuchen" },

  "screen:connector-list.title": { en: "Connectors", de: "Anschlüsse" },
  "screen:connector-pair.title": { en: "Pair a device", de: "Gerät koppeln" },
  "screen:connector-confirm.title": { en: "Confirm pairing", de: "Kopplung bestätigen" },

  "connectors.list.col.name": { en: "Name", de: "Name" },
  "connectors.list.col.status": { en: "Status", de: "Status" },
  "connectors.list.col.lastSeen": { en: "Last seen", de: "Zuletzt gesehen" },
  "connectors.list.col.version": { en: "Version", de: "Version" },
  "connectors.list.col.created": { en: "Created", de: "Angelegt" },
  [`${CONNECTOR_STATUS_OPTION_KEY_PREFIX}active`]: { en: "Active", de: "Aktiv" },
  [`${CONNECTOR_STATUS_OPTION_KEY_PREFIX}revoked`]: { en: "Revoked", de: "Gesperrt" },
  "connectors.list.revoke": { en: "Revoke", de: "Sperren" },
  "connectors.list.revoke.confirm": {
    en: "Revoke this connector? Its device stops delivering files at once.",
    de: "Diesen Anschluss sperren? Das Gerät kann sofort keine Dateien mehr liefern.",
  },
  "connectors.list.empty.title": { en: "No connectors yet", de: "Noch keine Anschlüsse" },
  "connectors.list.empty.hint": {
    en: "Start the satellite and enter the code it shows here.",
    de: "Starte den Satelliten und gib den angezeigten Code hier ein.",
  },

  "connectors.pair.title": { en: "Pair a device", de: "Gerät koppeln" },
  "connectors.list.neverSeen": { en: "never", de: "noch nie" },
  "connectors.pair.check": { en: "Check", de: "Prüfen" },
  "connectors.pair.submit": { en: "Confirm", de: "Bestätigen" },
  "connectors.pair.request.title": { en: "Pairing request", de: "Kopplungsanfrage" },
  "connectors.pair.request.at": { en: "Requested at", de: "Angefragt am" },
  "connectors.pair.request.ip": { en: "From IP address", de: "Von IP-Adresse" },

  [connectorFieldLabelKey("userCode")]: { en: "Code", de: "Code" },
  [connectorFieldLabelKey("name")]: { en: "Name", de: "Name" },
};
