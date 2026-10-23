export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
