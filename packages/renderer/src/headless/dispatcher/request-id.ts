import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// crypto.randomUUID where available (browser, Bun, Node); Math.random
// fallback for React-Native runtimes without the WebCrypto polyfill.
// Uniqueness only needs to hold per user within the server's dedup window —
// this is an idempotency key, not a security token.
export function generateRequestId(): string {
  const webCrypto = propertyOf(globalThis, "crypto");
  const randomUUID = propertyOf(webCrypto, "randomUUID");
  if (typeof randomUUID === "function") {
    const id: unknown = Reflect.apply(randomUUID, webCrypto, []);
    if (typeof id === "string") return id;
  }
  return `req-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
