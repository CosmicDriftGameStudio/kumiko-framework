/** Index of the first '<' past `maxTagOpeners`, or -1 while the HTML stays within the budget. */
export function tagOpenerBudgetCutoff(html: string, maxTagOpeners: number): number {
  let count = 0;
  let at = html.indexOf("<");
  while (at !== -1) {
    count += 1;
    if (count > maxTagOpeners) return at;
    at = html.indexOf("<", at + 1);
  }
  return -1;
}
