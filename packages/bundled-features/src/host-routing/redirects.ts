import { normalizeHostname } from "./host.ts";
import type { HostRoutingRedirect } from "./options.ts";

// Same-origin targets collapse leading slashes and backslashes so an appended
// "//evil.example" remainder can never turn into a protocol-relative URL.
export function sameOriginPath(path: string): string {
  return `/${path.replace(/^[/\\]+/, "")}`;
}

function remainderAfter(from: string, path: string): string | null {
  if (path === from) return "";
  const prefix = from.endsWith("/") ? from : `${from}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length - 1) : null;
}

export function matchRedirect(
  redirects: readonly HostRoutingRedirect[],
  host: string,
  path: string,
  search: string,
): { readonly to: string; readonly status: 301 | 302 } | undefined {
  const hostname = normalizeHostname(host);
  for (const rule of redirects) {
    if (rule.host !== undefined && rule.host !== hostname) continue;
    const remainder = remainderAfter(rule.from, path);
    if (remainder === null) continue;
    const target = rule.to.startsWith("https://")
      ? `${rule.to.replace(/\/$/, "")}${remainder}`
      : sameOriginPath(`${rule.to.replace(/\/$/, "")}${remainder}`);
    return { to: `${target}${search}`, status: rule.status ?? 301 };
  }
  return undefined;
}
