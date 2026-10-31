/** Caps lookup for `TierResolverDeps.capsForTier`: an unknown tier name falls back to the default
 *  tier (least-privileged by convention), a name missing from the map is a wiring bug and throws. */
export function capsForTierFromMap<TTier extends string, TCaps>(
  tierMap: Readonly<Record<TTier, { readonly caps: TCaps }>>,
  isTierName: (value: string) => value is TTier,
  defaultTier: TTier,
): (tier: string) => TCaps {
  return (tier) => {
    const name = isTierName(tier) ? tier : defaultTier;
    const def = tierMap[name];
    if (!def) {
      throw new Error(`tier-map: tier "${name}" not in tier map`);
    }
    return def.caps;
  };
}
