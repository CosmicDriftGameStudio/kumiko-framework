# Sample: Error-Contract

**Ich will einen Handler schreiben der sauber mit Fehlern umgeht — ohne HTTP-Codes, ohne JSON-Bodies, ohne try/catch-Ketten.**

## Was dieses Sample zeigt

Jede Kumiko-Error-Klasse im realen Handler-Kontext. Ein einzelnes Feature `orders-lite`, vier Handler, 7 Testfaelle die je eine typische Fehler-Situation zeigen.

## Das Rezept in 3 Saetzen

1. Handler wirft oder returnt einen `KumikoError` ueber `writeFailure(...)` oder `failNotFound(...)` / `failUnprocessable(...)`.
2. Der Dispatcher uebersetzt ihn in HTTP-Status + Wire-Format — immer `{ code, i18nKey, message, details?, requestId?, timestamp }`.
3. Der Client liest `error.code` (stabile Kategorie) oder `error.details.reason` (Feature-spezifischer Subtyp).

## Die Klassen — wann nutze ich welche?

| Klasse | HTTP | Benutzung im Handler |
|---|---|---|
| `ValidationError` | 400 | Automatisch aus Zod. Nie manuell werfen, nur fuer Validation-Hook-Fehler. |
| `AccessDeniedError` | 403 | "Du darfst das nicht" — Ownership, Role-Check, Field-Lock. |
| `NotFoundError` | 404 | Entity existiert nicht. Automatisch via `failNotFound(entity, id)`. |
| `ConflictError` | 409 | State-Kollision ohne Version (z.B. "paid orders can't be cancelled"). |
| `VersionConflictError` | 409 | Optimistic Lock — kommt aus CrudExecutor automatisch. Du wirfst sie nie. |
| `UnprocessableError` | 422 | Business-Regel verletzt. Der Reason-String beschreibt was. |
| `InternalError` | 500 | Wirfst du **nicht selbst**. Das Framework wrappt unerwartete Throws automatisch. |

## Convenience-Helper

Statt

```ts
return { isSuccess: false, error: toWriteErrorInfo(new NotFoundError("order", id)) };
```

schreib

```ts
return failNotFound("order", id);
```

Analog: `failUnprocessable("reason", details?)` und `writeFailure(new AnyKumikoError(...))`.

## Reason-Codes — die Konvention

Wenn dein Feature eine eigene Differenzierung braucht (z.B. `already_paid` vs. `already_cancelled`), nimm die `UnprocessableError` oder `ConflictError` und setze `details.reason`:

```ts
export const OrdersLiteReasons = {
  alreadyPaid: "already_paid",
  alreadyCancelled: "already_cancelled",
} as const;

return failUnprocessable(OrdersLiteReasons.alreadyPaid, { orderId });
```

**Regeln:**
- `snake_case`, keine Leerzeichen
- Ein `<Feature>Reasons` const-Object pro Feature
- Framework-Reasons (`stale_state`, `invalid_transition`, `field_access_denied`, `delete_restricted`) kommen aus `FrameworkReasons` — **wiederverwenden, nicht duplizieren**

## Throw vs. writeFailure

Beide enden im selben Wire-Format. Faustregel:

- **Handler-Top-Level** → `return writeFailure(new X())` oder die `failX(...)`-Helper. Der Rueckgabetyp ist explizit.
- **Tief in einer Helper-Funktion** → `throw new KumikoError(...)`. Sonst muesstest du `WriteResult` durch jede Funktionssignatur schleifen.

## Cause-Chain

Wenn du einen KumikoError wirfst der einen anderen Error als Ursache hat:

```ts
try {
  await externalApi.call();
} catch (e) {
  throw new ConflictError({
    message: "upstream rejected the sync",
    i18nKey: "orders-lite.errors.upstreamReject",
    details: { reason: "upstream_reject" },
    cause: e instanceof Error ? e : undefined,
  });
}
```

Die Kette landet im Log (fuer Forensik), aber **nicht** im Response an den Client. Kein manueller Filter noetig.

## Was du **nicht** machen sollst

- `throw new Error("string")` — wird zu `InternalError` (500), der Client sieht keinen hilfreichen Fehler
- `return { isSuccess: false, error: "string" }` — kein gueltiger `WriteErrorInfo`, TypeScript blockt es aber es ist ein typisches Muster aus Pre-v1-Code
- Eigene `class MyError extends Error` — auch das wird zu `InternalError`. Nutze `UnprocessableError` + `details.reason` fuer Feature-Subtypen
- Reason-Strings wie `"userNotAllowedToEditRecord"` (camelCase) oder mit Leerzeichen — die Konvention ist `snake_case`

## Weiterfuehrend

- Komplette Klassen-Definition: `packages/framework/src/errors/classes.ts`
- Goldstandard-Integration-Test: `packages/framework/src/__tests__/error-contract.integration.ts`
- Architekturplan: [`docs/plans/architecture/error-contract.md`](../../docs/plans/architecture/error-contract.md)
