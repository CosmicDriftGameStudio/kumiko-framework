export type DigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return out;
}

export async function digestHex(algorithm: DigestAlgorithm, text: string): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}
