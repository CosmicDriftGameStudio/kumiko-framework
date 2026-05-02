import {
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@kumiko/framework/engine";

// cap-counter — eine Row pro (tenantId, capName, periodStart). tenantId
// kommt automatisch als Base-Column (Kumiko Multi-Tenant-Default).
//
// **Identity-Modell:**
//   - aggregate-id: UUID (Kumiko-ES-Pflicht)
//   - public natural-key: (tenantId, capName, periodStart) — die Counter-
//     Engine nutzt deterministic uuidv5 daraus, damit Increments gegen
//     denselben Stream gehen statt zwei Rows pro Tenant+Cap zu erzeugen
//
// **Felder:**
//   - capName: das Domain-Konzept ("platform-mails", "ai-tokens-7day",
//     "db-storage-bytes"). Frei-form String — die App definiert ihre
//     Cap-Names, die Engine kennt sie nicht enumerated.
//   - value: aktueller Counter-Wert. Tokens, MB, Anzahl etc — Einheit
//     ist app-Sache, die Engine zählt nur Zahlen.
//   - periodStart: Timestamp wann das aktuelle Counter-Period begann.
//     Calendar-Month-Reset setzt einen neuen periodStart (= neue Aggregate-
//     Identität). Rolling-Window (z.B. KI-Tokens 7-day) setzt periodStart
//     einfach nicht zurück und filtert beim Read mit `WHERE timestamp >
//     now() - 7d` über den Event-Store-Stream — das ist Caller-Sache.
//   - lastSoftWarnedAt: Anti-Notification-Storm. Wenn Soft-Cap @ 110%
//     einmal erreicht ist, soll nicht jeder Folge-Increment eine Mail an
//     den Admin schicken. Pro Period maximal eine Soft-Warning, daher
//     diese Spalte; nullable, wird beim Reset auf null zurückgesetzt.
//
// **Was bewusst NICHT in der Entity steht:**
//   - softLimit / hardLimit / cap-toleranz-multipliers — die kommen aus
//     der App-TierMap zur enforceCap-Aufruf-Zeit. Counter weiß nichts
//     vom Tier, nur von "wie viele zähle ich".
//   - userId / aggregate-Reference — Counter sind Plattform-Tenant-
//     scoped, nicht User-scoped (auch wenn ein User den Increment
//     auslöst).
export const capCounterEntity = createEntity({
  table: "read_cap_counters",
  fields: {
    capName: createTextField({ required: true, maxLength: 100 }),
    value: createNumberField({ required: true, default: 0 }),
    periodStart: createTimestampField({ required: true }),
    lastSoftWarnedAt: createTimestampField(),
  },
});
