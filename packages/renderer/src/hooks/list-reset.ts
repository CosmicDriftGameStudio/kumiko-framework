type UrlParams = Readonly<Record<string, string | undefined>>;

const PAGE_SUFFIX = "page";

/** Exact `${screenId}.` prefix: `orders` must not match `orders-archive.q`. */
export function listParamKeys(params: UrlParams, screenId: string): string[] {
  const prefix = `${screenId}.`;
  return Object.keys(params).filter((key) => key.startsWith(prefix));
}

/** The page alone is navigation, not a deviation from the default view. */
export function isListStateAtDefault(params: UrlParams, screenId: string): boolean {
  const pageKey = `${screenId}.${PAGE_SUFFIX}`;
  return listParamKeys(params, screenId).every((key) => key === pageKey);
}

/** Nulling every list key lets defaultSort/defaultFilters apply again, and drops the `~` "no filter" markers. */
export function listResetUpdates(params: UrlParams, screenId: string): Record<string, null> {
  return Object.fromEntries(listParamKeys(params, screenId).map((key) => [key, null]));
}
