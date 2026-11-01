type BrowserName = "Edge" | "Opera" | "Firefox" | "Chrome" | "Safari";
type OsName = "Windows" | "macOS" | "iOS" | "Android" | "Linux";

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
const BROWSER_PATTERNS: readonly (readonly [BrowserName, RegExp])[] = [
  ["Edge", /\bEdg(?:e|A|iOS)?\/(\d+)/],
  ["Opera", /\b(?:OPR|Opera)\/(\d+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /\b(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /\bVersion\/(\d+)[\s\S]*\bSafari\//],
];

// iOS and Android UAs also contain "Mac OS X" / "Linux", so they are tested first.
const OS_PATTERNS: readonly (readonly [OsName, RegExp])[] = [
  ["iOS", /\b(?:iPhone|iPad|iPod)\b/],
  ["Android", /\bAndroid\b/],
  ["Windows", /\bWindows\b/],
  ["macOS", /\bMac OS X\b|\bMacintosh\b/],
  ["Linux", /\b(?:Linux|X11)\b/],
];

const CONNECTOR_BY_LANGUAGE: Readonly<Record<string, string>> = { de: "auf", en: "on" };

function languageOf(locale: string): string {
  return locale.split("-")[0]?.toLowerCase() ?? "en";
}

// Null when the UA names no known browser; the browser column is a hint for operators, not an identity.
export function summarizeUserAgent(userAgent: string | undefined, locale: string): string | null {
  if (userAgent === undefined) return null;
  const browser = BROWSER_PATTERNS.map(([name, pattern]) => {
    const version = pattern.exec(userAgent)?.[1];
    return version === undefined ? undefined : `${name} ${version}`;
  }).find((summary) => summary !== undefined);
  if (browser === undefined) return null;
  const os = OS_PATTERNS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  if (os === undefined) return browser;
  return `${browser} ${CONNECTOR_BY_LANGUAGE[languageOf(locale)] ?? "on"} ${os}`;
}
