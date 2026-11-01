import type { ApiDocsTexts } from "./types.ts";

export const deApiDocsTexts = {
  text: {
    "overview.title": "HTTP-API",
    "overview.description":
      "Endpunkte, Request-Body, Antworten, Fehlercodes, Listen und Batches der HTTP-API.",
    "overview.intro":
      "Jeder Aufruf ist ein POST mit JSON-Body. Das Feld `type` nennt den Handler, `payload` enthält dessen Felder. Die Referenzseiten listen jeden Handler mit seinen Feldern.",
    "overview.endpoints.heading": "Endpunkte",
    "overview.endpoints.query": "Liest Daten. Ändert nie etwas.",
    "overview.endpoints.write":
      "Ändert Daten: anlegen, ändern, löschen oder eine bestimmte Aktion.",
    "overview.endpoints.batch": "Führt mehrere Schreibaufrufe in einer Transaktion aus.",
    "overview.auth.heading": "Authentifizierung",
    "overview.auth.body":
      "Sende einen API-Token im Header `Authorization` als `Bearer <token>`. Anfragen mit Token brauchen weder Cookie noch CSRF-Token. Der Token legt auch das Konto fest, in dem die Anfrage läuft. Du sendest also nie eine Konto- oder Mandanten-ID.",
    "overview.body.heading": "Request-Body",
    "overview.body.body":
      "`type` ist der Name des Handlers, zum Beispiel `{exampleType}`. `payload` enthält die Felder aus der Referenz. `requestId` ist optional, siehe unten. Das Payload darf höchstens {maxDepth} Ebenen tief verschachtelt sein.",
    "overview.responses.heading": "Antworten",
    "overview.responses.success":
      "Ein erfolgreiches Lesen liefert `data`. Ein erfolgreiches Schreiben liefert `isSuccess: true` und `data`.",
    "overview.responses.error":
      "Bei einem Fehler ist der HTTP-Status 4xx oder 5xx und der Body enthält `error`. Schreibaufrufe liefern zusätzlich `isSuccess: false`. Werte `error.code` und den Status aus. `message` ist für Menschen gedacht und kann sich ändern.",
    "overview.errors.heading": "Fehlercodes",
    "overview.errors.columns": "Code | HTTP-Status | Bedeutung",
    "overview.versions.heading": "Versionen und Konflikte",
    "overview.versions.body":
      "Jeder Datensatz hat eine `version`. Ein Update nimmt die `version`, die du zuletzt gelesen hast. Hat jemand den Datensatz zwischenzeitlich geändert, schlägt der Aufruf mit 409 `version_conflict` fehl. Lies den Datensatz neu, prüfe die Änderung und sende sie mit der neuen Version.",
    "overview.lists.heading": "Listen",
    "overview.lists.intro": "Listen-Handler enden auf `:list` und akzeptieren diese Felder:",
    "overview.lists.columns": "Feld | Typ | Beschreibung",
    "overview.lists.response":
      "Die Antwort enthält `rows` und `nextCursor`. Für die nächste Seite sendest du `nextCursor` als `cursor`. Auf der letzten Seite ist `nextCursor` `null`.",
    "overview.batch.heading": "Batches",
    "overview.batch.body":
      "`POST /api/batch` nimmt `commands`, eine Liste von Schreibaufrufen `{ type, payload }`. Sie laufen in einer Transaktion: Schlägt einer fehl, wirkt keiner. Die Antwort hat dann `isSuccess: false`, den `error` und `failedIndex`, die Position des fehlgeschlagenen Befehls ab 0 gezählt.",
    "overview.retry.heading": "Sicher wiederholen",
    "overview.retry.body":
      "Sende bei Schreib- und Batch-Aufrufen eine `requestId` mit. Das ist ein beliebiger String, der pro Änderung eindeutig ist. Reißt die Verbindung ab und du sendest denselben Aufruf mit derselben `requestId` erneut, bekommst du das erste Ergebnis zurück und die Änderung läuft nicht doppelt.",
    "tokens.title": "API-Tokens",
    "tokens.description":
      "Lege einen API-Token für {appName} an, wähle seine Scopes und sende ihn mit deinen Anfragen.",
    "tokens.intro":
      "Mit einem API-Token kann ein Skript oder ein anderer Dienst die API von {appName} in deinem Namen aufrufen. Seine Scopes bestimmen, welche Daten er lesen oder ändern darf.",
    "tokens.create.heading": "Token anlegen",
    "tokens.create.step1": "Öffne {menuPath}.",
    "tokens.create.step2": "Wähle **{createLabel}**.",
    "tokens.create.step3":
      "Gib einen Namen ein, wähle die Scopes und das Ablaufdatum und bestätige mit deinem Passwort.",
    "tokens.create.step4":
      "Kopiere den Token. Er beginnt mit `kpat_` und wird nur einmal angezeigt.",
    "tokens.expiry":
      "Ein Token läuft nach {defaultDays} Tagen ab, wenn du keinen anderen Ablauf wählst. Möglich sind höchstens {maxDays} Tage.",
    "tokens.use.heading": "Token verwenden",
    "tokens.use.body":
      "Sende den Token im Header `Authorization`. Anfragen mit Token brauchen weder Cookie noch CSRF-Token.",
    "tokens.scopes.heading": "Scopes",
    "tokens.scopes.intro":
      "Jeder Scope hat zwei Stufen. `read` erlaubt die lesenden Handler. `write` erlaubt alles, was `read` erlaubt, und zusätzlich die schreibenden Handler.",
    "tokens.scopes.columns": "Scope | Berechtigung | Handler",
    "tokens.rateLimit.heading": "Ratenbegrenzung",
    "tokens.rateLimit":
      "Jeder Token darf {max} Anfragen pro {windowSeconds} Sekunden senden. Darüber antwortet die API mit 429 `pat_rate_limited`.",
    "tokens.errors.heading": "Fehler",
    "tokens.errors.columns": "HTTP-Status | Code | Ursache",
    "tokens.errors.missing": "Es fehlt der Header `Authorization`.",
    "tokens.errors.invalid": "Der Token ist unbekannt, widerrufen oder abgelaufen.",
    "tokens.errors.scope": "Dem Token fehlt der Scope für diesen Handler.",
    "tokens.errors.route":
      "Der Endpunkt nimmt keine Tokens an. Tokens funktionieren nur an den API-Endpunkten.",
    "tokens.errors.rate": "Zu viele Anfragen mit diesem Token.",
    "tokens.errors.disabled": "API-Tokens sind nicht Teil deines Tarifs.",
    "tokens.revoke.heading": "Token widerrufen",
    "tokens.revoke.body":
      "Widerrufe einen Token in {menuPath}, sobald du ihn nicht mehr brauchst. Wenn du dein Passwort änderst, werden alle deine Tokens widerrufen. Ein Token handelt immer mit deinen aktuellen Rollen. Verlässt du das Konto oder wird dein Benutzer gelöscht, funktioniert er nicht mehr.",
    "tokens.security.heading": "Sicherheit",
    "tokens.security.item1":
      "Behandle einen Token wie ein Passwort. Bewahre ihn in einem Secret Store auf, nie im Code, in einem Repository, in einer App oder Webseite oder in einem Log.",
    "tokens.security.item2":
      "Gib jedem Skript einen eigenen Token mit nur den Scopes, die es braucht.",
    "tokens.security.item3":
      "Widerrufe Tokens, die du nicht mehr nutzt. Widerrufe einen Token sofort, wenn er in fremde Hände gelangt sein könnte.",
    "reference.description":
      "API-Referenz für {scopeLabel}: jeder Handler mit seinen Feldern und einem Beispiel.",
    "reference.requiredScope": "Benötigter Scope",
    "reference.endpoint": "Endpunkt",
    "reference.fields.columns": "Feld | Typ | Pflicht | Beschreibung",
    "reference.yes": "ja",
    "reference.no": "nein",
    "reference.noFields": "Dieser Handler nimmt keine Felder.",
    "reference.excluded": "Über die API nicht setzbar: {fields}.",
    "reference.exampleRequest": "Beispielanfrage",
    "reference.exampleResponse": "Beispielantwort",
    "reference.status": "Status: {status}",
    "events.title": "Webhook-Ereignisse",
    "events.description":
      "Webhook-Ereignisse: wann sie ausgelöst werden, welchen Scope sie brauchen und was ihre Nutzlast enthält.",
    "events.intro":
      "Ein Webhook-Ereignis meldet deinem System, dass sich etwas geändert hat. Jedes Ereignis hat einen Namen, eine Version und eine Nutzlast. Der bei einem Ereignis genannte Scope ist der Token-Scope, der das Abonnieren erlaubt.",
    "events.delivery.heading": "Zustellung",
    "events.versions.heading": "Versionen",
    "events.versions.body":
      "Ein neues optionales Feld behält die Version. Eine inkompatible Änderung, etwa ein entferntes oder umbenanntes Feld oder ein geänderter Typ, bekommt eine neue Version.",
    "events.list.heading": "Ereignisse",
    "events.version": "Version",
    "events.requiredScope": "Benötigter Scope",
    "events.example": "Beispiel-Nutzlast",
    "events.noFields": "Dieses Ereignis enthält keine Felder.",
    "events.entity.created": "Ein Datensatz vom Typ {entity} wurde angelegt.",
    "events.entity.updated": "Ein Datensatz vom Typ {entity} wurde geändert.",
    "events.entity.deleted": "Ein Datensatz vom Typ {entity} wurde gelöscht.",
  },
  errorMeanings: {
    validation_error:
      "Das Payload passt nicht zu den Feldern des Handlers. `details` nennt die Felder.",
    unauthenticated: "Es wurden keine gültigen Zugangsdaten gesendet.",
    missing_token: "Der Header `Authorization` fehlt.",
    invalid_token: "Der Token ist unbekannt, widerrufen oder abgelaufen.",
    ambiguous_auth: "Die Anfrage enthielt Session-Cookie und Token. Sende nur eines von beiden.",
    access_denied:
      "Dem Token fehlt der Scope für diesen Handler, oder der Endpunkt nimmt keine Tokens an.",
    feature_disabled: "Diese Funktion ist abgeschaltet oder nicht Teil deines Tarifs.",
    not_found: "Der Datensatz existiert nicht oder du darfst ihn nicht sehen.",
    conflict: "Die Änderung widerspricht dem aktuellen Stand der Daten.",
    version_conflict:
      "Der Datensatz hat sich nach deinem Lesen geändert. Lies ihn neu und wiederhole mit der neuen `version`.",
    precondition_failed:
      "Ein Feld des Datensatzes hat nicht mehr den Wert, den die Änderung erwartet hat. Lies den Datensatz neu und wiederhole.",
    record_locked: "Eine andere Änderung sperrt den Datensatz. Wiederhole gleich.",
    idempotent_replay:
      "Diese Änderung wurde unter demselben Idempotenz-Schlüssel schon ausgeführt. Der erste Versuch war erfolgreich, sende sie nicht noch einmal.",
    unique_violation: "Ein Datensatz mit diesem Wert existiert bereits.",
    unprocessable:
      "Die Daten sind gültig, aber eine Fachregel lehnt die Änderung ab. `details.reason` nennt die Regel.",
    unconfigured:
      "Eine Einstellung, die diese Funktion braucht, ist noch leer. Richte sie zuerst in der App ein und wiederhole dann.",
    internal_error: "Unerwarteter Serverfehler. Wiederhole später.",
    member_read_timeout:
      "Ein Lesevorgang auf dem Server hat zu lange gedauert und wurde abgebrochen. Wiederhole später.",
    rate_limited:
      "Zu viele Anfragen. Warte so viele Sekunden, wie der Header `Retry-After` angibt.",
    rate_limit_unavailable:
      "Die Ratenbegrenzung ist vorübergehend nicht verfügbar, die Anfrage wurde abgelehnt. Wiederhole gleich.",
    pat_rate_limited:
      "Dieser Token hat in kurzer Zeit zu viele Anfragen gesendet. Warte einen Moment und wiederhole.",
  },
  listParameters: {
    cursor: "Position aus `nextCursor` der vorherigen Seite.",
    limit: "Zeilen pro Seite, standardmäßig {default}, höchstens {max}.",
    search: "Volltextsuche über die durchsuchbaren Felder.",
    sort: "Feld, nach dem sortiert wird.",
    sortDirection: "`asc` oder `desc`.",
    offset: "Anzahl der zu überspringenden Zeilen. Nutze besser `cursor` zum Blättern.",
    totalCount: "Mit `true` bekommst du zusätzlich `total`, die Anzahl der passenden Zeilen.",
    includeDeleted:
      "Mit `true` sind gelöschte Zeilen enthalten. Nur für Entitäten mit Soft Delete.",
    onlyDeleted:
      "Mit `true` kommen nur gelöschte Zeilen zurück. Nur für Entitäten mit Soft Delete, nicht zusammen mit `includeDeleted`.",
    filter: "Ein Feldfilter mit `field`, `op` und `value`. `op` ist einer von {ops}.",
    filters: "Mehrere Feldfilter, je mit `field`, `op` und `value`. `op` ist einer von {ops}.",
    namedFilter: "Name eines vordefinierten Filters der Entität, zum Beispiel einer Arbeitsliste.",
    aggregate: "Liefert aggregierte Werte statt Zeilen.",
  },
} as const satisfies ApiDocsTexts;
