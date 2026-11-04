// Labels may repeat along a path; the occurrence count keeps React keys unique.
export function uniqueLabelKeys(labels: readonly string[]): readonly string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const occurrence = seen.get(label) ?? 0;
    seen.set(label, occurrence + 1);
    return `${label}#${occurrence}`;
  });
}
