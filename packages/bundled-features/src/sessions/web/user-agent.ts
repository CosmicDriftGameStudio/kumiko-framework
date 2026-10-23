import * as z from "zod";

export const USER_AGENT_BROWSERS = [
  "Edge",
  "Opera",
  "Samsung Internet",
  "Firefox",
  "Chrome",
  "Safari",
] as const;
export const USER_AGENT_OPERATING_SYSTEMS = [
  "Windows",
  "iOS",
  "Android",
  "macOS",
  "ChromeOS",
  "Linux",
] as const;

export type UserAgentBrowser = (typeof USER_AGENT_BROWSERS)[number];
export type UserAgentOperatingSystem = (typeof USER_AGENT_OPERATING_SYSTEMS)[number];

export const parsedDeviceSchema = z
  .object({
    browser: z.enum(USER_AGENT_BROWSERS).nullable(),
    browserMajor: z.number().int().nullable(),
    os: z.enum(USER_AGENT_OPERATING_SYSTEMS).nullable(),
  })
  .nullable();

export type ParsedDevice = z.infer<typeof parsedDeviceSchema>;

// Order matters: Chromium forks and iOS Chrome/Firefox also carry the engine tokens of the browsers they derive from.
const BROWSER_PATTERNS: readonly {
  readonly browser: UserAgentBrowser;
  readonly pattern: RegExp;
}[] = [
  { browser: "Edge", pattern: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
  { browser: "Opera", pattern: /\bOPR\/(\d+)/ },
  { browser: "Samsung Internet", pattern: /\bSamsungBrowser\/(\d+)/ },
  { browser: "Firefox", pattern: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { browser: "Chrome", pattern: /\b(?:Chrome|CriOS)\/(\d+)/ },
  { browser: "Safari", pattern: /\bVersion\/(\d+)[\s\S]*\bSafari\// },
];

// iPhone/iPad UAs say "like Mac OS X" and Android UAs say "Linux", so the more specific systems come first.
const OPERATING_SYSTEM_PATTERNS: readonly {
  readonly os: UserAgentOperatingSystem;
  readonly pattern: RegExp;
}[] = [
  { os: "Windows", pattern: /\bWindows\b/ },
  { os: "iOS", pattern: /\b(?:iPhone|iPad|iPod)\b/ },
  { os: "Android", pattern: /\bAndroid\b/ },
  { os: "macOS", pattern: /\bMacintosh\b/ },
  { os: "ChromeOS", pattern: /\bCrOS\b/ },
  { os: "Linux", pattern: /\bLinux\b/ },
];

export function formatDeviceLabel(device: ParsedDevice): string | null {
  if (device === null) return null;
  const browser =
    device.browser === null
      ? null
      : device.browserMajor === null
        ? device.browser
        : `${device.browser} ${device.browserMajor}`;
  const parts = [browser, device.os].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function parseUserAgent(userAgent: string | null): ParsedDevice {
  if (userAgent === null || userAgent === "") return null;
  let browser: UserAgentBrowser | null = null;
  let browserMajor: number | null = null;
  for (const candidate of BROWSER_PATTERNS) {
    const match = candidate.pattern.exec(userAgent);
    if (match) {
      browser = candidate.browser;
      browserMajor = match[1] === undefined ? null : Number(match[1]);
      break;
    }
  }
  const os =
    OPERATING_SYSTEM_PATTERNS.find((candidate) => candidate.pattern.test(userAgent))?.os ?? null;
  return browser === null && os === null ? null : { browser, browserMajor, os };
}
