---
"@cosmicdrift/kumiko-framework": minor
---

`createEmbeddedListField(schema)`: ein Feldtyp fuer Listen typisierter Objekte. `createEmbeddedField` beschreibt genau ein Objekt; eine Liste gleichartiger Objekte liess sich damit nicht ausdruecken und landete bisher als freies jsonb, dessen Form nur der Handler kannte.

Das neue Feld validiert jede Zeile gegen dasselbe Sub-Schema, das `createEmbeddedField` schon kennt. Storage bleibt jsonb, der Spalten-Default wird `[]` statt `{}`. `required: true` heisst „mindestens eine Zeile" — dieselbe Lesart wie bei `multiSelect`.

Gedacht ist es fuer Zeilen, die zusammen mit ihrem Kopf entstehen und mit ihm unveraenderlich bleiben: Buchungszeilen, Belegpositionen. Sobald eine Zeile eine eigene Lebensdauer hat — eigenes Von/Bis, eigene Historie — gehoert sie in eine eigene Entity mit Referenz auf den Kopf. Ein eingebettetes Array wird bei jeder Aenderung ganz neu geschrieben und hat keine Historie pro Zeile.

Erster Konsument ist `ledger.transaction.lines`. Die Form der Buchungszeile haengt jetzt am Typ statt am Handler; die zeilenuebergreifenden Invarianten (Summe = 0, mindestens zwei verschiedene Konten) bleiben da, wo sie hingehoeren — im Payload-Schema des Kommandos. Datenseitig ist das ein No-op: die Spalte enthielt immer schon Arrays, nur ihr Default war `{}`. Apps mit gemountetem `ledger` bekommen von `kumiko-schema generate` ein `ALTER COLUMN … SET DEFAULT '[]'::jsonb`.

Ausserdem gefixt: der Read-Side-Feldfilter behandelte einen Array-Wert wie ein einzelnes Objekt und machte aus `[{…}, {…}]` ein `{0: {…}, 1: {…}}` — dabei fielen die Zugriffsregeln der Sub-Felder still weg. Jede Zeile wird jetzt einzeln gefiltert, das Array bleibt ein Array. Searchable Sub-Felder einer Liste indexieren einen Wert pro Zeile.
