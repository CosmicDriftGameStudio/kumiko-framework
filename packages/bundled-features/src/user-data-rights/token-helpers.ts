// Generates a cryptographically secure token to authorize the export ZIP download.
// Follows the Magic-Link/Bearer-Token pattern with a hash stored in the database:
//
//   1. The worker generates a plain token (32 random bytes, base64url) and its hash
//      (SHA256 hex).
//   2. The database stores ONLY the hash. The plain token remains in worker memory.
//   3. The notification step sends the plain token to the user by email.
//   4. The download endpoint hashes the incoming token and compares it with the
//      database hash using a constant-time comparison to prevent timing attacks.
//
// **Multi-use within TTL:** The token is NOT "consumed" on download, so the user
// can download repeatedly until expiresAt. This matches Google-Takeout (7d) and
// Facebook-Data-Download (4d).
//
// **Universal Web-Crypto API:** crypto.getRandomValues + crypto.subtle.digest
// runs identically in Bun, Node 19+, and browsers, avoiding platform-specific
// imports.

/**
 * Generates a new download token. The plain token is sent to the user by email;
 * the hash is stored in the token database row.
 *
 * Token format: 32 random bytes → base64url-encoded (~43 chars). URL-safe for
 * Magic-Link use (no +/= characters that would need to be URL-encoded).
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
 * Hashes a plain token into its database representation. In the verification path,
 * the download endpoint hashes the incoming token and looks up the hash in the
 * database. A constant-time string comparison prevents timing attacks; the caller
 * performs it via `crypto.subtle` or a secure comparison helper.
 */
export async function hashDownloadToken(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return uint8ArrayToHex(new Uint8Array(digest));
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  // btoa expects a binary string. atob/btoa are universal in Bun, Node, and browsers.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number); // @cast-boundary dynamic-key
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] as number).toString(16).padStart(2, "0"); // @cast-boundary dynamic-key
  }
  return out;
}
