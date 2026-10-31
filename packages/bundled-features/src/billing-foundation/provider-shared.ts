import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

export function validateOneOffPriceIds(providerLabel: string, priceIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const priceId of priceIds) {
    if (priceId.length === 0) {
      throw new Error(`${providerLabel}: oneOffPriceIds must not contain an empty string`);
    }
    if (seen.has(priceId)) {
      throw new Error(`${providerLabel}: duplicate oneOffPriceIds entry "${priceId}"`);
    }
    seen.add(priceId);
  }
}

// backing:"secrets" values are stored JSON-serialized, so the store read has to
// be parsed back; the env fallback is a plain string and stays raw. The error
// must not carry the input: the JSON parser's own message would repeat the
// credential into logs and, for webhooks, into the 401 body.
export function parseStoredSecret(
  providerLabel: string,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = parseJsonSafe<unknown>(raw, undefined);
  if (parsed === undefined) {
    throw new Error(`${providerLabel} credential (backing:secrets) is not valid JSON`);
  }
  return typeof parsed === "string" && parsed.length > 0 ? parsed : undefined;
}

export type TtlPriceCache<TPrice> = {
  readonly get: (priceId: string) => TPrice | undefined;
  readonly set: (priceId: string, price: TPrice) => void;
};

export type TtlPriceCacheOptions = {
  readonly ttlMs?: number;
  readonly now: () => number;
};

export function createTtlPriceCache<TPrice>({
  ttlMs = 600_000,
  now,
}: TtlPriceCacheOptions): TtlPriceCache<TPrice> {
  const store = new Map<string, { readonly price: TPrice; readonly expiresAt: number }>();
  return {
    get: (priceId) => {
      const entry = store.get(priceId);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(priceId);
        return undefined;
      }
      return entry.price;
    },
    set: (priceId, price) => {
      store.set(priceId, { price, expiresAt: now() + ttlMs });
    },
  };
}
