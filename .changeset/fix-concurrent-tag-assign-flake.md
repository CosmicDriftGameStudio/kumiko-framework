---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Zwei konkurrierende erste `assign-tag`-Aufrufe auf dieselbe (tag, entity)-Kombination konnten mit einem rohen 500 `internal_error` statt dem erwarteten konvergierten Erfolg fehlschlagen (`kumiko-framework#1778`), CI-Flake auf `main`.

Root Cause 1 (framework): `create()`/`update()` im `EventStoreExecutor` riefen `append()` direkt auf der äußeren Dispatcher-Transaktion auf. postgres.js/Bun.SQL vergiften den ganzen umschließenden `begin()`-Block, sobald darin ein Statement fehlschlägt — auch wenn der JS-Fehler bereits sauber zu `version_conflict` klassifiziert wurde. Der Verlierer-Schreiber bekam dadurch beim Commit den rohen `PostgresError` statt der bereits klassifizierten `WriteFailure`. Fix: `append()` läuft jetzt in einem `SAVEPOINT` (`runInSavepointIfSupported`), das isoliert zurückrollt statt die ganze Transaktion zu vergiften — mit Fallback auf einen direkten Aufruf, sowohl wenn `db` eine reine Pool-Connection ohne aktive Transaktion ist (Seeds/Tests) als auch wenn ein `afterCommit`-Hook einen bereits committeten Transaktions-Handle wiederverwendet (PG 25P01 „no active sql transaction").

Root Cause 2 (bundled-features): unabhängig davon konvergierte der `assign-tag`-Handler nur den `create()`-vs-`create()`-Race (`version_conflict`), nicht das schmalere Fenster, in dem der Verlierer nach einem `detail()`-Miss auf `restore()` trifft, während der Gewinner die aktive Zeile bereits geschrieben hat (`restore()` liefert dann `unprocessable/not_deleted`). Der Handler konvergiert diesen Fall jetzt ebenfalls zu Erfolg.
