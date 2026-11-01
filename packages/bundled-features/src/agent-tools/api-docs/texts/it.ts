import type { ApiDocsTexts } from "./types.ts";

export const itApiDocsTexts = {
  text: {
    "overview.title": "API HTTP",
    "overview.description":
      "Endpoint, corpo della richiesta, risposte, codici di errore, elenchi e batch dell'API HTTP.",
    "overview.intro":
      "Ogni chiamata è un POST con corpo JSON. Il campo `type` indica l'handler, `payload` contiene i suoi campi. Le pagine di riferimento elencano ogni handler con i suoi campi.",
    "overview.endpoints.heading": "Endpoint",
    "overview.endpoints.query": "Legge dati. Non modifica mai nulla.",
    "overview.endpoints.write":
      "Modifica dati: creare, aggiornare, eliminare o un'azione specifica.",
    "overview.endpoints.batch": "Esegue più chiamate di scrittura in una transazione.",
    "overview.auth.heading": "Autenticazione",
    "overview.auth.body":
      "Invia un token API nell'header `Authorization` come `Bearer <token>`. Le richieste con token non richiedono cookie né token CSRF. Il token stabilisce anche l'account in cui gira la richiesta, quindi non invii mai un ID di account o di tenant.",
    "overview.body.heading": "Corpo della richiesta",
    "overview.body.body":
      "`type` è il nome dell'handler, per esempio `{exampleType}`. `payload` contiene i campi del riferimento. `requestId` è facoltativo, vedi sotto. Il payload può essere annidato al massimo per {maxDepth} livelli.",
    "overview.responses.heading": "Risposte",
    "overview.responses.success":
      "Una lettura riuscita restituisce `data`. Una scrittura riuscita restituisce `isSuccess: true` e `data`.",
    "overview.responses.error":
      "In caso di errore lo stato HTTP è 4xx o 5xx e il corpo contiene `error`. Le chiamate di scrittura restituiscono anche `isSuccess: false`. Valuta `error.code` e lo stato. `message` è pensato per le persone e può cambiare.",
    "overview.errors.heading": "Codici di errore",
    "overview.errors.columns": "Codice | Stato HTTP | Significato",
    "overview.versions.heading": "Versioni e conflitti",
    "overview.versions.body":
      "Ogni record ha una `version`. Un aggiornamento usa la `version` che hai letto per ultima. Se nel frattempo qualcuno ha modificato il record, la chiamata fallisce con 409 `version_conflict`. Rileggi il record, controlla la modifica e inviala con la nuova versione.",
    "overview.lists.heading": "Elenchi",
    "overview.lists.intro": "Gli handler di elenco finiscono con `:list` e accettano questi campi:",
    "overview.lists.columns": "Campo | Tipo | Descrizione",
    "overview.lists.response":
      "La risposta contiene `rows` e `nextCursor`. Per la pagina successiva invia `nextCursor` come `cursor`. Nell'ultima pagina `nextCursor` è `null`.",
    "overview.batch.heading": "Batch",
    "overview.batch.body":
      "`POST /api/batch` accetta `commands`, un elenco di chiamate di scrittura `{ type, payload }`. Vengono eseguite in una transazione: se una fallisce, nessuna ha effetto. La risposta ha allora `isSuccess: false`, l'`error` e `failedIndex`, la posizione del comando fallito contata da 0.",
    "overview.retry.heading": "Ripetere in sicurezza",
    "overview.retry.body":
      "Invia un `requestId` con le chiamate di scrittura e di batch, una stringa qualsiasi unica per ogni modifica. Se la connessione cade e invii di nuovo la stessa chiamata con lo stesso `requestId`, ricevi il primo risultato e la modifica non viene eseguita due volte.",
    "tokens.title": "Token API",
    "tokens.description":
      "Crea un token API per {appName}, scegli i suoi scope e invialo con le tue richieste.",
    "tokens.intro":
      "Un token API permette a uno script o a un altro servizio di chiamare l'API di {appName} a tuo nome. I suoi scope decidono quali dati può leggere o modificare.",
    "tokens.create.heading": "Creare un token",
    "tokens.create.step1": "Apri {menuPath}.",
    "tokens.create.step2": "Scegli **{createLabel}**.",
    "tokens.create.step3":
      "Inserisci un nome, scegli gli scope e la scadenza e conferma con la tua password.",
    "tokens.create.step4": "Copia il token. Inizia con `kpat_` e viene mostrato una sola volta.",
    "tokens.expiry":
      "Un token scade dopo {defaultDays} giorni se non scegli un'altra scadenza. La scadenza massima possibile è di {maxDays} giorni.",
    "tokens.use.heading": "Usare il token",
    "tokens.use.body":
      "Invia il token nell'header `Authorization`. Le richieste con token non richiedono cookie né token CSRF.",
    "tokens.scopes.heading": "Scope",
    "tokens.scopes.intro":
      "Ogni scope ha due livelli. `read` consente gli handler di lettura. `write` consente tutto ciò che consente `read` più gli handler di scrittura.",
    "tokens.scopes.columns": "Scope | Permesso | Handler",
    "tokens.rateLimit.heading": "Limite di richieste",
    "tokens.rateLimit":
      "Ogni token può inviare {max} richieste ogni {windowSeconds} secondi. Oltre, l'API risponde 429 `pat_rate_limited`.",
    "tokens.errors.heading": "Errori",
    "tokens.errors.columns": "Stato HTTP | Codice | Causa",
    "tokens.errors.missing": "Manca l'header `Authorization`.",
    "tokens.errors.invalid": "Il token è sconosciuto, revocato o scaduto.",
    "tokens.errors.scope": "Al token manca lo scope per questo handler.",
    "tokens.errors.route":
      "L'endpoint non accetta token. I token funzionano solo sugli endpoint dell'API.",
    "tokens.errors.rate": "Troppe richieste con questo token.",
    "tokens.errors.disabled": "I token API non fanno parte del tuo piano.",
    "tokens.revoke.heading": "Revocare un token",
    "tokens.revoke.body":
      "Revoca un token in {menuPath} non appena smetti di usarlo. Cambiare la password revoca tutti i tuoi token. Un token agisce sempre con i tuoi ruoli attuali. Se lasci l'account o il tuo utente viene eliminato, smette di funzionare.",
    "tokens.security.heading": "Sicurezza",
    "tokens.security.item1":
      "Tratta un token come una password. Conservalo in un archivio di segreti, non nel codice né in un repository.",
    "tokens.security.item2":
      "Dai a ogni script il suo token, con solo gli scope di cui ha bisogno.",
    "tokens.security.item3": "Revoca i token che non usi più.",
    "reference.description":
      "Riferimento API per {scopeLabel}: ogni handler con i suoi campi e un esempio.",
    "reference.requiredScope": "Scope richiesto",
    "reference.endpoint": "Endpoint",
    "reference.fields.columns": "Campo | Tipo | Obbligatorio | Descrizione",
    "reference.yes": "sì",
    "reference.no": "no",
    "reference.noFields": "Questo handler non accetta campi.",
    "reference.excluded": "Non impostabili tramite API: {fields}.",
    "reference.exampleRequest": "Richiesta di esempio",
    "reference.exampleResponse": "Risposta di esempio",
    "reference.status": "Stato: {status}",
  },
  errorMeanings: {
    validation_error: "Il payload non corrisponde ai campi dell'handler. `details` indica i campi.",
    unauthenticated: "Non sono state inviate credenziali valide.",
    missing_token: "Manca l'header `Authorization`.",
    invalid_token: "Il token è sconosciuto, revocato o scaduto.",
    ambiguous_auth:
      "La richiesta conteneva sia un cookie di sessione sia un token. Invia solo uno dei due.",
    access_denied:
      "Al token manca lo scope per questo handler, oppure l'endpoint non accetta token.",
    feature_disabled: "Questa funzione è disattivata o non fa parte del tuo piano.",
    not_found: "Il record non esiste o non puoi vederlo.",
    conflict: "La modifica è in conflitto con lo stato attuale dei dati.",
    version_conflict:
      "Il record è cambiato dopo la tua lettura. Rileggilo e riprova con la nuova `version`.",
    precondition_failed:
      "Un campo del record non ha più il valore che la modifica si aspettava. Rileggi il record e riprova.",
    record_locked: "Un'altra modifica blocca il record. Riprova tra poco.",
    idempotent_replay:
      "Questa modifica è già stata applicata con la stessa chiave di idempotenza. Il primo tentativo è riuscito, quindi non inviarla di nuovo.",
    unique_violation: "Esiste già un record con questo valore.",
    unprocessable:
      "I dati sono validi, ma una regola di business rifiuta la modifica. `details.reason` indica la regola.",
    unconfigured:
      "Un'impostazione necessaria a questa funzione è ancora vuota. Configurala prima nell'app, poi riprova.",
    internal_error: "Errore imprevisto del server. Riprova più tardi.",
    member_read_timeout:
      "Una lettura sul server ha impiegato troppo tempo ed è stata interrotta. Riprova più tardi.",
    rate_limited:
      "Troppe richieste. Attendi il numero di secondi indicato dall'header `Retry-After`.",
    rate_limit_unavailable:
      "Il limite di frequenza è temporaneamente non disponibile e la richiesta è stata rifiutata. Riprova tra poco.",
    pat_rate_limited:
      "Questo token ha inviato troppe richieste in poco tempo. Attendi un momento e riprova.",
  },
  listParameters: {
    cursor: "Posizione da `nextCursor` della pagina precedente.",
    limit: "Righe per pagina, {default} per impostazione predefinita, al massimo {max}.",
    search: "Ricerca full-text nei campi ricercabili.",
    sort: "Campo per cui ordinare.",
    sortDirection: "`asc` o `desc`.",
    offset: "Numero di righe da saltare. Per sfogliare è meglio `cursor`.",
    totalCount: "Con `true` ricevi anche `total`, il numero di righe corrispondenti.",
    includeDeleted:
      "Con `true` sono incluse le righe eliminate. Solo per entità con eliminazione logica.",
    onlyDeleted:
      "Con `true` vengono restituite solo le righe eliminate. Solo per entità con eliminazione logica, non insieme a `includeDeleted`.",
    filter: "Un filtro di campo con `field`, `op` e `value`. `op` è uno tra {ops}.",
    filters: "Più filtri di campo, ciascuno con `field`, `op` e `value`. `op` è uno tra {ops}.",
    namedFilter: "Nome di un filtro predefinito dell'entità, per esempio una coda di lavoro.",
    aggregate: "Restituisce valori aggregati invece di righe.",
  },
} as const satisfies ApiDocsTexts;
