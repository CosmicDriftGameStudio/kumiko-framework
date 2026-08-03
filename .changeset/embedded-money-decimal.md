---
"@cosmicdrift/kumiko-framework": minor
---

Embedded-Sub-Felder kennen jetzt `money` und `decimal`. Bisher erlaubte `EmbeddedSubFieldDef` nur `text | number | boolean | date` — ein Betrag in einer Buchungszeile oder Belegposition konnte nur `number` sein, und der Typ sagte nicht, ob der Wert Euro oder Cent meint.

`{ type: "money" }` ist ein vorzeichenbehafteter Ganzzahlbetrag in Minor Units (Cents); die Waehrung definiert das Kopf-Aggregat, nicht die Zeile. Anders als das Top-Level-`money`-Feld (BIGINT + Waehrungsspalte) liegt der Wert in jsonb und muss innerhalb von ±(2^53 − 1) bleiben — die Write-Validierung erzwingt das.

`{ type: "decimal", scale: N }` begrenzt eine JSON-Zahl auf `scale` Nachkommastellen (0–15), fuer Mengen wie Stunden oder Quadratmeter. `scale` ist Pflicht, ein `precision` gibt es nicht — hinter jsonb steht keine numeric-Spalte, deren Breite es beschreiben koennte. Der Scale-Check ist float-robust (dieselbe `isRepresentableAtScale`-Semantik wie beim Top-Level-`decimal`).

Erster Konsument ist `ledger.transaction.lines.amount`, das von `number` auf `money` wechselt. Die Werte dort waren schon immer Minor Units (das Kommando-Schema validierte `int`), jetzt sagt es der Typ. Datenseitig und im DDL ist das ein No-op.
