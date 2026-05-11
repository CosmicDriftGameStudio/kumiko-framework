// Download-Token-Helper (S2.U3 Atom 4a).
//
// Generiert ein kryptographisch-sicheres Token zur Authorisierung des
// Export-ZIP-Downloads. Pattern matched Magic-Link/Bearer-Token mit DB-
// gespeichertem Hash:
//
//   1. Worker generiert plain-Token (32 byte random base64url) + Hash
//      (SHA256 hex).
//   2. DB speichert NUR den Hash. Plain bleibt im Worker-Memory.
//   3. Atom 5 (Notification) versendet plain via Email an User.
//   4. Atom 4b (Download-Endpoint) hashet incoming-Token + vergleicht
//      mit DB-Hash → konstantes-Zeit-Vergleich gegen timing-attacks.
//
// **Multi-use within TTL** (User-Choice 4a-Plan): Token wird NICHT
// "consumed" beim Download — User kann mehrfach downloaden bis expiresAt.
// Pattern matched Google-Takeout (7d) + Facebook-Data-Download (4d).
//
// **Universal Web-Crypto API:** crypto.getRandomValues + crypto.subtle.digest
// laeuft in Bun + Node 19+ + Browser identisch — keine plattform-
// spezifischen Imports (Memory `feedback_universal_deps`).

/**
 * Generiert ein neues Download-Token. plain wird dem User via Email
 * zugestellt (Atom 5); hash landet in der Token-DB-Row.
 *
 * Token-Format: 32 byte random → base64url-encoded (~43 chars). URL-safe
 * fuer Magic-Link-Verwendung (kein +/= das URL-encoded werden muesste).
 */
export async function generateDownloadToken(): Promise<{
  readonly plain: string;
  readonly hash: string;
}> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const plain = uint8ArrayToBase64Url(randomBytes);
  const hash = await hashDownloadToken(plain);
  return { plain, hash };
}

/**
 * Hashed einen plain-Token zu seiner DB-Repraesentation. Verify-Pfad
 * (Atom 4b's Download-Endpoint): hashed incoming-Token + sucht den Hash
 * in DB. Konstante-Zeit-String-Vergleich verhindert timing-attacks
 * (das macht der Caller via `crypto.subtle`-vergleich oder secure-
 * compare-helper).
 */
export async function hashDownloadToken(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return uint8ArrayToHex(new Uint8Array(digest));
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  // btoa erwartet binary-string. atob/btoa sind universal in Bun + Node + Browser.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return out;
}
