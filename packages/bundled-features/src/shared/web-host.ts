export function webHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.host : null;
  } catch {
    return null;
  }
}
