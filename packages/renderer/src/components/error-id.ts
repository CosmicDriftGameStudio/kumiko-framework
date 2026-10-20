import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// The server's client-error endpoint requires a uuid, so the Math.random fallback
// (runtimes without WebCrypto) keeps the uuid v4 shape.
export function createErrorId(): string {
  const webCrypto = propertyOf(globalThis, "crypto");
  const randomUUID = propertyOf(webCrypto, "randomUUID");
  if (typeof randomUUID === "function") {
    const id: unknown = Reflect.apply(randomUUID, webCrypto, []);
    if (typeof id === "string") return id;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (placeholder) => {
    const nibble = Math.floor(Math.random() * 16);
    return (placeholder === "x" ? nibble : (nibble % 4) + 8).toString(16);
  });
}
