export function readPathParam(
  search: string,
  paramName: string,
  isSafePath: (candidate: unknown) => candidate is string,
): string | null {
  const candidate = new URLSearchParams(search).get(paramName);
  return isSafePath(candidate) ? candidate : null;
}
