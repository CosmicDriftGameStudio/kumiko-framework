---
status: reference
verified: 2026-08-14
---

# Body-Limit-Inventar: welche Routes sind heute effektiv unlimitiert

> Stand vor fw#2145. `BODY_LIMIT_PATHS` ist inzwischen invertiert zu
> `BODY_LIMIT_OPT_OUT_PATHS` (`api-constants.ts`) — der Default deckt jetzt
> `/api/*` by construction ab, nur `/api/files` opted aus. `sse` bleibt bewusst
> ohne Opt-out unter dem Default, weil die Route den Request-Body nie liest
> (siehe Analyse unten) — das Limit ist dort harmlos, nicht falsch.

`registerBodyLimit` (`src/api/route-registrars.ts`) ist default-on mit 1 MiB
(`DEFAULT_MAX_REQUEST_BYTES`), hängt aber an `BODY_LIMIT_PATHS` — einer
handgepflegten Liste mit 5 Einträgen. `Routes` (`src/api/api-constants.ts`)
definiert 30 Pfad-Konstanten. Diese Bestandsaufnahme listet für jede Route, ob
sie heute effektiv limitiert ist, und ob ein Invertieren (Folge-Issue: "erst
alles limitieren, dann explizit ausnehmen") einen Opt-out oder einen
Consumer-Hinweis braucht.

## Methodik

- `BODY_LIMIT_PATHS` = `/api/write`, `/api/batch`, `/api/query`, `/api/command`,
  `/api/auth/*`.
- Hono-Wildcard-Semantik empirisch geprüft, nicht angenommen — inklusive der
  echten Mount-Topologie (Body-Limit-Middleware auf dem Root-`app`, Auth-Routen
  leben auf einem separat gemounteten Sub-App via `app.route("/api", authApp)`,
  genau wie in `server.ts:733`). Ergebnis: `app.use("/api/auth/*", mw)` greift
  für mehrsegmentige Unterpfade (`/api/auth/mfa/verify`) **und** für den nackten
  `/api/auth`-Pfad selbst — auch wenn der Body auf einem separat gemounteten
  Sub-App-Handler landet. Ein Testskript mit `bodyLimit({maxSize:10})` + realer
  `app.route`-Topologie lieferte für alle drei Fälle `413` bei einem 50-Byte-Body.
  Damit deckt der eine Wildcard-Eintrag **alle** `auth*`-Routes ab, unabhängig
  von Verschachtelungstiefe.
- Zweiter Test: `hono/body-limit` auf einer GET-Route mit `streamSSE`-Response
  geprüft (kleiner Request-Body, 3 SSE-Frames als Response) — die Middleware
  prüft ausschließlich den eingehenden Request-Body, die gestreamte Response
  kommt unverändert durch. Relevant für die Einschätzung bei `sse`/`stream`
  unten.
- Für jede Route wurde die tatsächliche Registrierung im Code verifiziert
  (`app.get/post(...)`, inkl. der beiden Helper `registerTokenRequestRoute`/
  `registerTokenConfirmRoute`, die beide intern `opts.api.post(...)` nutzen),
  nicht nur die Existenz der `Routes`-Konstante.

## Zähl-Rekonstruktion: die 22 aus dem Issue

Das `Routes`-Objekt hat **30** Einträge, aber "22" lässt sich rekonstruieren:
**22 = alle POST-Routes, die über eine `Routes.*`-Konstante registriert sind.**

- `src/api/routes.ts`: 5 POST-Registrierungen über `Routes.*`
  (`write`, `batch`, `query`, `command`, `stream`).
- `src/api/auth-routes.ts`: 18 Registrierungen über `Routes.*`, davon 17 POST
  und 1 GET (`authTenants`) — die 17 POSTs sind `authLogin`, `authMfaVerify`,
  `authMfaPreauthEnableStart`, `authMfaPreauthConfirm`, `authLogout`,
  `authSwitchTenant`, `authRequestPasswordReset`, `authResetPassword`,
  `authRequestEmailVerification`, `authVerifyEmail`,
  `authRequestAccountUnlock`, `authConfirmAccountUnlock`,
  `authSignupRequest`, `authSignupConfirm`, `authInviteAccept`,
  `authInviteAcceptWithLogin`, `authInviteSignupComplete`.
- 5 + 17 = **22.**

Was in dieser Zählung fehlt (und warum das für die Body-Limit-Frage relevant
ist):

- `POST /files` fehlt, weil die Route mit dem String-Literal `"/files"`
  registriert ist (`file-routes.ts:108`), nicht über `Routes.files` — ein
  `grep "Routes\.\w+"`-basierter Zähler würde sie nicht finden. Sie ist aber
  ein echter, unlimitierter Endpoint und gehört zwingend in diese
  Bestandsaufnahme (siehe unten).
- Reine GET-Routes (`health`, `healthReady`, `version`, `sse`, `authTenants`)
  zählen nicht mit, weil ein Body-Limit für sie keine praktische Bedeutung
  hat (siehe Einschätzung unten) — vermutlich der gleiche Grund, warum der
  Issue-Autor sie nicht mitgezählt hat.
- `auth` (`"/auth"`) ist keine eigene registrierte Route, nur ein
  Namespace-Präfix für den Wildcard-Eintrag `/api${Routes.auth}/*`.
- `authInviteInfo` (`"/auth/invite-info"`) ist in `Routes` und in
  `PUBLIC_API_PATHS` gelistet, hat aber **keinen registrierten Handler** in
  `auth-routes.ts` — totes/vorbereitetes Wiring, unabhängig von diesem Issue.
  Als Fund dokumentiert, ggf. eigenes Ticket wert.

Die Tabelle unten ist trotzdem vollständig für **alle** 30 `Routes`-Einträge,
nicht nur für die 22 POST-Routes — Body-Limit-relevant sind zwar in erster
Linie die POST-Routes, aber die GET-Routes gehören für eine vollständige
Bestandsaufnahme mit rein.

## Tabelle: alle Routes

| Route (Konstante) | Pfad | Methode | Aktuell limitiert | Deckung |
|---|---|---|---|---|
| `health` | `/health` (root-mounted, NICHT `/api/health`) | GET | nein | — (kein Body-Read im Handler) |
| `healthReady` | `/health/ready` (root-mounted) | GET | nein | — (kein Body-Read im Handler) |
| `version` | `/version` (root-mounted) | GET | nein | — (kein Body-Read im Handler) |
| `write` | `/api/write` | POST | **ja** | direkt in `BODY_LIMIT_PATHS` |
| `batch` | `/api/batch` | POST | **ja** | direkt in `BODY_LIMIT_PATHS` |
| `query` | `/api/query` | POST | **ja** | direkt in `BODY_LIMIT_PATHS` |
| `command` | `/api/command` | POST | **ja** | direkt in `BODY_LIMIT_PATHS` |
| `sse` | `/api/sse` | GET | nein | — (Broker-basiert, kein Body-Read) |
| `stream` | `/api/stream` | POST | **nein** | — nicht in `BODY_LIMIT_PATHS`, obwohl `{type, payload}`-Shape identisch zu `command`/`query` |
| `auth` | `/api/auth` | — | n/a | kein registrierter Handler, nur Wildcard-Präfix |
| `authLogin` | `/api/auth/login` | POST | **ja** | via `/api/auth/*`-Wildcard |
| `authMfaVerify` | `/api/auth/mfa/verify` | POST | **ja** | via Wildcard |
| `authMfaPreauthEnableStart` | `/api/auth/mfa/preauth-enable-start` | POST | **ja** | via Wildcard |
| `authMfaPreauthConfirm` | `/api/auth/mfa/preauth-confirm` | POST | **ja** | via Wildcard |
| `authLogout` | `/api/auth/logout` | POST | **ja** | via Wildcard |
| `authTenants` | `/api/auth/tenants` | GET | **ja** | via Wildcard (harmlos, kein Body-Read) |
| `authSwitchTenant` | `/api/auth/switch-tenant` | POST | **ja** | via Wildcard |
| `authRequestPasswordReset` | `/api/auth/request-password-reset` | POST | **ja**\* | via Wildcard, nur wenn `config.passwordReset` gesetzt |
| `authResetPassword` | `/api/auth/reset-password` | POST | **ja**\* | via Wildcard, nur wenn `config.passwordReset` gesetzt |
| `authRequestEmailVerification` | `/api/auth/request-email-verification` | POST | **ja**\* | via Wildcard, nur wenn `config.emailVerification` gesetzt |
| `authVerifyEmail` | `/api/auth/verify-email` | POST | **ja**\* | via Wildcard, nur wenn `config.emailVerification` gesetzt |
| `authRequestAccountUnlock` | `/api/auth/request-account-unlock` | POST | **ja**\* | via Wildcard, nur wenn `config.accountUnlock` gesetzt |
| `authConfirmAccountUnlock` | `/api/auth/confirm-account-unlock` | POST | **ja**\* | via Wildcard, nur wenn `config.accountUnlock` gesetzt |
| `authSignupRequest` | `/api/auth/signup-request` | POST | **ja**\* | via Wildcard, nur wenn `config.signup` gesetzt |
| `authSignupConfirm` | `/api/auth/signup-confirm` | POST | **ja**\* | via Wildcard, nur wenn `config.signup` gesetzt |
| `authInviteAccept` | `/api/auth/invite-accept` | POST | **ja**\* | via Wildcard, nur wenn `config.invite` gesetzt |
| `authInviteAcceptWithLogin` | `/api/auth/invite-accept-with-login` | POST | **ja**\* | via Wildcard, nur wenn `config.invite` gesetzt |
| `authInviteSignupComplete` | `/api/auth/invite-signup-complete` | POST | **ja**\* | via Wildcard, nur wenn `config.invite` gesetzt |
| `authInviteInfo` | `/api/auth/invite-info` | — | n/a | kein registrierter Handler (siehe oben) |
| `files` (String-Literal, keine `Routes`-Konstante genutzt) | `/api/files` | POST | **nein** | eigener Mechanismus, siehe unten |

\* Diese Auth-Routes werden nur gemountet, wenn die App das jeweilige
Feature (`passwordReset`/`emailVerification`/`accountUnlock`/`signup`/`invite`)
konfiguriert. Wenn gemountet, sind sie durch den Wildcard immer mitgedeckt —
es gibt keinen Fall, in dem eine `auth*`-Route existiert, aber ungedeckt ist.

**Zusammenfassung:** 4 Routes direkt gelistet, 18 weitere über den
`/api/auth/*`-Wildcard automatisch mitgedeckt (17 POST + `authTenants` GET;
auth-Namespace ist safe by construction — jede künftige `/auth/*`-Route erbt
den Schutz ohne Listen-Pflege). Macht 4 + 18 = **22 effektiv limitierte
Routes**. Effektiv **6 Routes ohne Body-Limit**: `health`, `healthReady`,
`version`, `sse`, `stream`, `files`. (4 + 18 + 6 = 28 gemountete Routes;
`auth` als Präfix ohne Handler und `authInviteInfo` ohne Handler machen die
30 aus `Routes` voll.)

Achtung, zwei unterschiedliche 22er: die "22" oben in der
Zähl-Rekonstruktion sind alle POST-Routes über eine `Routes.*`-Konstante
(inkl. `stream`, exkl. `authTenants`, das ein GET ist). Die "22" hier sind
die tatsächlich limitierten Routes (inkl. `authTenants`, exkl. `stream`, das
ja gerade unlimitiert ist). Gleiche Zahl, unterschiedliche Mengen — der
Unterschied ist genau der Swap `stream` ↔ `authTenants`.

## Einschätzung je unlimitierter Route

### `health`, `healthReady`, `version` — kein Handlungsbedarf, aber auch kein "fällt unter Default"

Alle drei sind reine GET-Handler, die den Request-Body nie lesen
(`registerHealthRoutes`, `registerVersionRoute`, beide auf dem **Root**-`app`
registriert — nicht über `app.route("/api", ...)`). Damit liegen sie
tatsächlich unter `/health`, `/health/ready`, `/version`, nicht unter
`/api/health` etc., obwohl `PUBLIC_API_PATHS` sie unter dem `/api`-Präfix
listet (vermutlich ein vorbestehendes, von diesem Issue unabhängiges
Inventar-Detail, nicht body-limit-relevant). Falls das Invertierungs-Issue
den neuen Default z. B. als `app.use("/api/*", limit)` umsetzt, werden diese
drei root-mounteten Routes davon gar nicht erfasst — sie liegen außerhalb des
`/api`-Namespace. Das ist unkritisch, weil die Handler den Body ohnehin nie
lesen, aber die "Aktion beim Invertieren"-Tabelle unten benennt das explizit
statt es implizit unter "fällt unter Default" zu verstecken.

### `sse` (`GET /api/sse`) — kein Handlungsbedarf

Broker-basiert (`createSseRoute`), liest den Request-Body nicht. Per
Testskript bestätigt: `hono/body-limit` auf einer streamenden GET-Route prüft
nur den Request-Body, die Response-Stream-Frames laufen unverändert durch —
ein Body-Limit hier wäre also harmlos, aber auch wirkungslos (nichts zu
schützen). Kein Opt-out, kein Changelog-Hinweis nötig.

### `stream` (`POST /api/stream`) — Lücke, gehört direkt in die Liste

`createApiRoutes` (`src/api/routes.ts:154`) liest denselben
`{ type: string; payload: unknown }`-Body wie `/query` und `/command`
(`c.req.json()`), dispatcht über `dispatcher.stream(...)`. Die Response ist
SSE (per bestätigtem Testskript unproblematisch mit `bodyLimit` kombinierbar),
aber der **Request**-Body ist strukturell identisch zu den bereits gelisteten
Dispatcher-Routes. Der Ausschluss aus `BODY_LIMIT_PATHS` sieht nach einem
Versehen aus (die 4 anderen Dispatcher-Endpunkte sind gelistet, dieser fünfte
nicht), nicht nach Absicht. Im Repo gibt es keine internen Consumer, die hier
große Payloads schicken (nur Test-Aufrufe mit trivialen `{ count }`-Payloads,
siehe `pipeline/__tests__/dispatcher.test.ts`). Downstream-Apps
(enterprise/studio) liegen außerhalb dieses Repos und konnten hier nicht
geprüft werden — falls eine App `payload` für z. B. einen großen Text/AI-Prompt
nutzt, wäre das strukturell dasselbe Risiko wie bei `/command` heute schon.

**Empfehlung fürs Invertierungs-Issue:** `/stream` direkt mit in die
Standard-1-MiB-Grenze aufnehmen (kein Opt-out) — kein Consumer-Hinweis nötig,
da die Payload-Semantik identisch zu den bereits limitierten Dispatcher-Routes
ist und dort kein Bedarf für größere Bodies bestand.

### `files` (`POST /api/files`) — braucht einen echten Opt-out mit höherem Limit

`createFileRoutes` (`src/files/file-routes.ts:108`) macht
`c.req.parseBody()` (multipart) **ohne** vorgeschaltetes `hono/body-limit` —
die Größenprüfung (`validateFile`, Zeile 151) läuft erst **nachdem** der
komplette Body bereits eingelesen wurde. Der Default für `maxUploadSize` ist
`"10mb"` (Zeile 137), pro Entity-Feld überschreibbar über `fieldDef.maxSize`.
10 MB liegt bereits 10× über `DEFAULT_MAX_REQUEST_BYTES` (1 MiB) — Datei-Uploads
sind bewusst als Ausnahme vom generischen JSON-Limit gedacht (Kommentar in
`route-registrars.ts:33`: "File uploads keep their own per-field maxSize").

**Einschätzung:** Kein Bug, aber beim Invertieren zwingend ein expliziter
Opt-out (oder ein eigener, höherer `hono/body-limit`-Eintrag für `/api/files`,
z. B. an `maxUploadSize` gekoppelt) — sonst würde das generische 1-MiB-Limit
jeden Upload über 1 MB hart brechen, noch bevor `validateFile` greift, und
den Anwendungsfall zerstören, für den die Route existiert. Zusätzlich lohnt
sich unabhängig vom Invertierungs-Issue ein Blick darauf, dass die
Größenprüfung derzeit erst *nach* dem vollen Body-Read passiert (Memory-Kosten
für übergroße Requests, bevor sie abgelehnt werden) — das ist aber ein
separates DoS-Härtungs-Thema, kein Body-Limit-Inventar-Scope.

## Für das Invertierungs-Issue (Nächster Schritt, blockiert durch #2144)

| Route | Aktion beim Invertieren |
|---|---|
| `health`, `healthReady`, `version` | keine — root-mounted, liegen ohnehin außerhalb eines `/api/*`-Invert-Scopes; Body wird nie gelesen |
| `sse` | keine — Body-Limit auf einer streamenden Route ist harmlos, aber wirkungslos |
| `write`, `batch`, `query`, `command`, `auth*` (18 Routes) | keine Änderung — bereits limitiert |
| `stream` | in die Liste aufnehmen (kein Opt-out, keine Konstruktion nötig — einfacher Listen-Fix) |
| `files` | expliziter Opt-out mit eigenem, höherem Limit gekoppelt an `maxUploadSize`; Changelog-Hinweis für Consumer, die den Default-Upload-Endpoint mit Custom-`maxSize`-Feldern >1 MiB nutzen |
| `authInviteInfo` | kein Body-Limit-Thema (kein Handler) — als Fund an Issue-Autor:in melden, evtl. eigenes Ticket |
