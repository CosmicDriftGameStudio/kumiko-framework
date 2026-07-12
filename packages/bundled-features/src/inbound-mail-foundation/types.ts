// Provider-Contract für inbound-mail-Provider-Plugins (Plan §2).
//
// Gespiegelt von mail-foundation's MailTransportContext/-Plugin —
// gleiche Trennung Foundation ↔ Provider, gleicher Slim-Context.
//
// **Warum kein voller HandlerContext?** fetch()/watch() laufen im
// Worker-Pfad (Poll-Cron, IDLE-Supervisor) — dort gibt es keinen
// per-request `tx`/`actor`. Ein Plugin das mehr liest würde den
// Worker-Pfad zur Runtime brechen, und das fiele nur in production
// auf. Plugin das mehr braucht: InboundMailContext explizit erweitern
// (sichtbarer breaking change) statt ctx-cast.

import type { ConfigAccessor, Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { InboundMailAccountStatus } from "./constants";

/**
 * Slim-Context für Provider-Plugins.
 *
 * **Felder:**
 *   config   — tenant-config-reads (host/port/... der Plugins)
 *   registry — extension-Lookup in der Factory (nicht plugin-intern)
 *   secrets  — tenant-secret-reads (IMAP-Passwort, OAuth-Refresh-Token)
 *   _userId  — Audit-Identity für secret-reads. Handler-Pfad: dispatcher
 *              setzt Caller-User-ID; Worker-Pfad: System-Identity.
 */
export type InboundMailContext = {
  readonly config?: ConfigAccessor;
  readonly registry?: Registry;
  readonly secrets?: import("@cosmicdrift/kumiko-framework/secrets").SecretsContext;
  readonly _userId?: string | undefined;
};

/**
 * Plaintext-Sicht auf ein verbundenes Postfach, wie Provider sie sehen.
 * Die Foundation decryptet `address` VOR dem Provider-Call — Provider
 * arbeiten nie mit `kumiko-pii:`-Ciphertext (Guard analog
 * withPiiCiphertextGuard im Transport-Pfad).
 */
export type MailAccountRecord = {
  /** = aggregateId des mail-account-Streams; zugleich Secret-Slot-Key. */
  readonly id: string;
  readonly tenantId: string;
  /** Provider-Key wie bei der Extension registriert ("imap", "m365-graph",
   *  "gmail-rest"). */
  readonly provider: string;
  /** "password" | "xoauth2" | "oauth" — imap unterscheidet hierüber
   *  Formular-Connect vs. XOAUTH2-Fallback (Plan §2). */
  readonly authMethod: string;
  /** null = tenant-geteiltes Postfach, sonst persönliches Postfach
   *  dieses Users (Sichtbarkeits-Scope, Plan Entscheidung 2). */
  readonly ownerUserId: string | null;
  /** Postfach-Adresse, Plaintext (decrypted). */
  readonly address: string;
  readonly displayName: string;
  readonly status: InboundMailAccountStatus;
  readonly watchState: string;
};

/**
 * Normalisierte eingehende Mail — Provider-Output, Ingest-Input.
 * Provider-raw-Strukturen (IMAP-Flags, Graph-Objekte) bleiben im
 * Provider; hier nur der domain-clean Schnitt.
 */
export type RawInboundMessage = {
  /** Provider-native Message-ID (IMAP UID, Graph id, Gmail id) —
   *  Idempotency-Anchor zusammen mit providerName. */
  readonly providerMessageId: string;
  /** RFC-5322 Message-ID-Header ohne <>; null wenn der Header fehlt
   *  (Foundation fällt auf deterministischen Ersatz zurück). */
  readonly messageIdHeader: string | null;
  /** Provider-native Thread-/Conversation-ID falls vorhanden (Graph
   *  conversationId, Gmail threadId); Foundation bevorzugt sie vor der
   *  References-Chain beim threadKey-Bau. */
  readonly providerThreadId: string | null;
  /** References/In-Reply-To-Chain (Message-IDs ohne <>), älteste zuerst. */
  readonly references: readonly string[];
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  /** Plaintext-Vorschau, provider-generiert oder aus dem Body geschnitten. */
  readonly snippet: string;
  /** ISO-Instant — INTERNALDATE bzw. receivedDateTime, nicht Ingest-Zeit. */
  readonly receivedAtIso: string;
  /** Raw MIME; null im snippet-only-Mode. Foundation persisted ihn nach
   *  file-foundation und schreibt bodyRef — der Event-Store bleibt
   *  blob-frei. */
  readonly rawMime: Uint8Array | null;
  /** Generischer Scope-Hint ("inbox", Folder-Name) — keine App-Semantik. */
  readonly scope: string;
};

/** Provider-opaker Cursor: IMAP {uidValidity,lastUid} · Graph {deltaLink}
 *  · Gmail {historyId}. Foundation persisted ihn JSON-stringified in
 *  read_mail_sync_cursors, interpretiert ihn nie. */
export type SyncCursorPayload = Readonly<Record<string, unknown>>;

export type InboundFetchResult = {
  readonly messages: readonly RawInboundMessage[];
  readonly nextCursor: SyncCursorPayload;
  /** true ⇒ Foundation ruft fetch im selben Poll-Tick erneut auf
   *  (Pagination), bis false oder maxMessages-Budget erschöpft. */
  readonly hasMore: boolean;
};

export type OAuthTokenSet = {
  readonly accessToken: string;
  /** ISO-Instant. TTL typisch ~1h ⇒ Foundation refresht before-poll. */
  readonly expiresAt: string;
  readonly refreshToken?: string;
  readonly scopesGranted: readonly string[];
};

/**
 * OAuth-Teil des Contracts — nur OAuth-Provider; imap (Passwort-Modus)
 * lässt `oauth` weg. Die Routen (`/inbound-mail/connect`,
 * `/inbound-mail/oauth/callback`) stellt die Foundation generisch —
 * Provider registrieren KEINE eigenen Routen.
 */
export type InboundOAuthFlow = {
  /** Scopes: Empfang UND Send in EINEM Consent — Re-Consent ist teuer. */
  readonly scopes: {
    readonly receive: readonly string[];
    readonly send?: readonly string[];
  };
  readonly buildAuthorizeUrl: (
    ctx: InboundMailContext,
    p: { readonly state: string; readonly redirectUri: string },
  ) => Promise<string>;
  readonly exchangeCode: (
    ctx: InboundMailContext,
    p: { readonly code: string; readonly redirectUri: string },
  ) => Promise<OAuthTokenSet>;
  readonly refreshAccessToken: (
    ctx: InboundMailContext,
    account: MailAccountRecord,
    refreshToken: string,
  ) => Promise<OAuthTokenSet>;
};

/**
 * Inbound-Mail-Provider-Plugin contract. Jedes Provider-Feature
 * (inbound-provider-imap, -m365-graph, -gmail-rest) registriert eine
 * Implementation via `r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION,
 * "<key>", plugin)`.
 */
export type InboundMailProviderPlugin = {
  /** Credentials-/Erreichbarkeits-Check beim Connect-Flow — wirft
   *  typisiert (InboundAuthError etc.), kein Rückgabewert. */
  readonly verify: (ctx: InboundMailContext, account: MailAccountRecord) => Promise<void>;
  /** Pull seit cursor. `cursor === null` ⇒ Erst-Befüllung, begrenzt
   *  durch backfillWindowDays. */
  readonly fetch: (
    ctx: InboundMailContext,
    account: MailAccountRecord,
    cursor: SyncCursorPayload | null,
    opts: { readonly backfillWindowDays: number; readonly maxMessages: number },
  ) => Promise<InboundFetchResult>;
  /** Nur OAuth-Provider. */
  readonly oauth?: InboundOAuthFlow;
  /** Optional: Live-Push (IMAP IDLE, später Graph/Gmail-Webhooks).
   *  Liefert stop(). Poll bleibt Reconciliation — watch ist Latenz-
   *  Optimierung, nie Korrektheits-Anker. `onError` meldet den Tod der
   *  Live-Verbindung (Drop, Auth-Revoke) an den Supervisor, der mit
   *  Backoff neu startet — der Provider reconnected NICHT selbst. */
  readonly watch?: (
    ctx: InboundMailContext,
    account: MailAccountRecord,
    handlers: {
      readonly onMessages: (msgs: readonly RawInboundMessage[]) => Promise<void>;
      readonly onError: (err: unknown) => void;
    },
  ) => Promise<() => Promise<void>>;
};

// extension-usage `options` ist engine-payload (unknown) — strukturell
// validieren statt blind casten (Muster isMailTransportPlugin).
export function isInboundMailProviderPlugin(o: unknown): o is InboundMailProviderPlugin {
  return (
    typeof o === "object" &&
    o !== null &&
    "verify" in o &&
    typeof (o as { verify: unknown }).verify === "function" &&
    "fetch" in o &&
    typeof (o as { fetch: unknown }).fetch === "function"
  );
}

// =============================================================================
// Typisierte Fehlerklassen — Foundation reagiert einheitlich im Poll
// (Plan §2, Fehler-Tabelle):
//   InboundAuthError          → status=auth_error, kein Retry
//   InboundRateLimitError     → Poll-Abbruch, nächster Cron-Tick
//   InboundCursorInvalidError → Cursor-Reset + Voll-Resync im Backfill-
//                               Fenster; Dedup fängt Dubletten
//   InboundTransientError     → Job-Retry (retries: 3, exponential)
// =============================================================================
//
// `kind`-Discriminant statt instanceof: Plugin und Foundation können in
// getrennten Bundles leben (dual-package-hazard), instanceof über
// Realm-/Kopie-Grenzen ist unzuverlässig.

export class InboundAuthError extends Error {
  readonly kind = "inbound-auth-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundAuthError";
  }
}

export class InboundRateLimitError extends Error {
  readonly kind = "inbound-rate-limit-error" as const;
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "InboundRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class InboundCursorInvalidError extends Error {
  readonly kind = "inbound-cursor-invalid-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundCursorInvalidError";
  }
}

export class InboundTransientError extends Error {
  readonly kind = "inbound-transient-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundTransientError";
  }
}

type KindCarrier = { readonly kind?: unknown };

export function isInboundAuthError(e: unknown): e is InboundAuthError {
  return e instanceof Error && (e as KindCarrier).kind === "inbound-auth-error";
}
export function isInboundRateLimitError(e: unknown): e is InboundRateLimitError {
  return e instanceof Error && (e as KindCarrier).kind === "inbound-rate-limit-error";
}
export function isInboundCursorInvalidError(e: unknown): e is InboundCursorInvalidError {
  return e instanceof Error && (e as KindCarrier).kind === "inbound-cursor-invalid-error";
}
export function isInboundTransientError(e: unknown): e is InboundTransientError {
  return e instanceof Error && (e as KindCarrier).kind === "inbound-transient-error";
}
