import * as z from "zod";

export type PriceEnvProvider<TEnvPrefix extends string> = {
  readonly envPrefix: TEnvPrefix;
  readonly label: string;
  readonly priceIdPrefix: string;
};

export type PriceEnvShape<TEnvPrefix extends string, TPrice extends string> = {
  [Key in `${TEnvPrefix}_PRICE_${TPrice}`]: z.ZodOptional<z.ZodString>;
};

export function priceEnvShape<const TEnvPrefix extends string, const TPrice extends string>(
  provider: PriceEnvProvider<TEnvPrefix>,
  prices: readonly TPrice[],
): PriceEnvShape<TEnvPrefix, TPrice> {
  const { envPrefix, label, priceIdPrefix } = provider;
  return Object.fromEntries(
    prices.map((price) => [
      `${envPrefix}_PRICE_${price}`,
      z
        .string()
        .regex(
          new RegExp(`^${priceIdPrefix}`),
          `${envPrefix}_PRICE_${price} must start with '${priceIdPrefix}'`,
        )
        .optional()
        .describe(`${label} price id (\`${priceIdPrefix}...\`) of the ${price} plan.`),
    ]),
    // @cast-boundary schema-walk — Object.fromEntries widens to an index signature; the entries are exactly one optional string per listed price.
  ) as PriceEnvShape<TEnvPrefix, TPrice>;
}

export function priceEnvSchema<
  TBaseShape extends z.ZodRawShape,
  const TEnvPrefix extends string,
  const TPrice extends string,
>(
  base: z.ZodObject<TBaseShape>,
  provider: PriceEnvProvider<TEnvPrefix>,
  prices: readonly TPrice[],
) {
  return z.object({ ...base.shape, ...priceEnvShape(provider, prices) });
}
