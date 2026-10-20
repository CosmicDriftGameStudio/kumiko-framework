import { DEFAULT_GLOBAL_RATE_LIMIT, type ServerOptions } from "@cosmicdrift/kumiko-framework/api";

type ServerRateLimit = NonNullable<ServerOptions["rateLimit"]>;

/** `false` per layer or for the whole option switches it off. */
export type RateLimitOption =
  | false
  | {
      readonly global?: false | ServerRateLimit["global"];
      readonly auth?: false | ServerRateLimit["auth"];
    };

export { DEFAULT_GLOBAL_RATE_LIMIT };
export const DEFAULT_AUTH_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

/** Layers the app did not mention keep their default; a layer it did mention
 *  overrides only the fields it names. */
export function resolveRateLimit(option: RateLimitOption | undefined): ServerRateLimit | undefined {
  if (option === false) return undefined;
  const { global, auth } = option ?? {};
  return {
    ...(global !== false && { global: { ...DEFAULT_GLOBAL_RATE_LIMIT, ...global } }),
    ...(auth !== false && { auth: { ...DEFAULT_AUTH_RATE_LIMIT, ...auth } }),
  };
}
