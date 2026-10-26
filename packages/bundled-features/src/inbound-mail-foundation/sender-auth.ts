// Sender authentication (SPF, DKIM, DMARC) as the receiving mail server reported it in its
// Authentication-Results header (RFC 8601). A wrong "pass" is a security bug, so every doubt
// ends in null (no statement) or "unknown".
//
// Trust (RFC 8601 sections 5 and 7.1): the account names the authserv-id of its own mail server
// (trustedAuthservId). Reading starts at the topmost Authentication-Results header; the first one
// whose authserv-id equals the trusted id counts, every header below it is ignored, because the
// receiving server prepends its own entry and anything further down may have been sent along by
// the sender. Without a trusted id, without a matching header or when the header was evaluated for
// another From domain than the mail's, there is no result at all.

import * as z from "zod";

export const SENDER_AUTH_VERDICTS = ["pass", "fail", "none", "unknown"] as const;
export type SenderAuthVerdict = (typeof SENDER_AUTH_VERDICTS)[number];

const verdictSchema = z.enum(SENDER_AUTH_VERDICTS);

export const MAX_DKIM_DOMAINS = 10;

export const senderAuthenticationSchema = z.object({
  /** The authserv-id of the trusted header the verdicts come from, lower case. */
  authservId: z.string().min(1).max(255),
  spf: verdictSchema,
  dkim: verdictSchema,
  /** header.d of the dkim results, lower case, at most MAX_DKIM_DOMAINS. */
  dkimDomains: z.array(z.string().max(255)).max(MAX_DKIM_DOMAINS),
  dmarc: verdictSchema,
  /** Domain of the mail's From address, lower case: the domain the dmarc verdict was bound to. */
  fromDomain: z.string().min(1).max(255),
});
export type SenderAuthentication = z.infer<typeof senderAuthenticationSchema>;
/** null = no trustworthy statement (no trusted id, no matching header, From domain mismatch). */
export const senderAuthenticationFieldSchema = senderAuthenticationSchema.nullable();

/** True only when the account's own server vouched for the From domain via DMARC. */
export function isSenderAuthenticated(
  senderAuthentication: SenderAuthentication | null | undefined,
): boolean {
  return senderAuthentication?.dmarc === "pass";
}

/** Empty input means "not set"; ids are compared case-insensitively, so they are stored lower case. */
export function normalizeTrustedAuthservId(raw: string | null | undefined): string | null {
  const id = raw?.trim().toLowerCase() ?? "";
  return id === "" ? null : id;
}

export function fromDomainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  const domain = (at < 0 ? "" : address.slice(at + 1)).trim().toLowerCase().replace(/>$/, "");
  return domain === "" ? null : domain;
}

const RESULT_TO_VERDICT: Readonly<Record<string, SenderAuthVerdict>> = {
  pass: "pass",
  fail: "fail",
  softfail: "fail",
  none: "none",
};

/** Index right after the quoted string that starts at `start`; a backslash escapes the next char. */
function quotedStringEnd(value: string, start: number): number {
  for (let i = start + 1; i < value.length; i++) {
    const char = value.charAt(i);
    if (char === "\\") i++;
    else if (char === '"') return i + 1;
  }
  return value.length;
}

/** Comments in parentheses may nest and may hide quoted text; folding is plain whitespace. */
function stripComments(value: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (depth === 0 && char === '"') {
      const end = quotedStringEnd(value, i);
      out += value.slice(i, end);
      i = end - 1;
    } else if (char === "\\" && depth > 0) {
      i++;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && depth > 0) {
      depth--;
    } else if (depth === 0) {
      out += char;
    }
  }
  return out;
}

function splitSegments(value: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (char === '"') {
      const end = quotedStringEnd(value, i);
      current += value.slice(i, end);
      i = end - 1;
    } else if (char === ";") {
      segments.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current.trim());
  return segments;
}

const RESULT_PATTERN = /^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)(?:\s|$)/i;
const PROPERTY_PATTERN = /(?:^|\s)header\.(d|from)\s*=\s*"?([^\s";]+)"?/gi;

type MethodResult = {
  readonly verdict: SenderAuthVerdict;
  readonly headerD: string | null;
  readonly headerFrom: string | null;
};

function propertyOf(segment: string, name: "d" | "from"): string | null {
  for (const match of segment.matchAll(PROPERTY_PATTERN)) {
    if (match[1]?.toLowerCase() === name) return (match[2] ?? "").toLowerCase();
  }
  return null;
}

function methodResults(segments: readonly string[]): {
  byMethod: Map<string, MethodResult[]>;
  headerFroms: string[];
} {
  const byMethod = new Map<string, MethodResult[]>();
  const headerFroms: string[] = [];
  for (const segment of segments) {
    const match = RESULT_PATTERN.exec(segment);
    if (!match) continue;
    const method = (match[1] ?? "").toLowerCase();
    const headerFrom = propertyOf(segment, "from");
    if (headerFrom !== null) headerFroms.push(headerFrom);
    const result: MethodResult = {
      verdict: RESULT_TO_VERDICT[(match[2] ?? "").toLowerCase()] ?? "unknown",
      headerD: propertyOf(segment, "d"),
      headerFrom,
    };
    byMethod.set(method, [...(byMethod.get(method) ?? []), result]);
  }
  return { byMethod, headerFroms };
}

// DKIM: one valid signature is enough, a mail may carry several.
function combineAnyPass(results: readonly MethodResult[] | undefined): SenderAuthVerdict {
  const verdicts = results?.map((result) => result.verdict) ?? [];
  if (verdicts.includes("pass")) return "pass";
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("none")) return "none";
  return "unknown";
}

// SPF and DMARC have one verdict per mail; contradicting entries must never read as a pass.
function combineAllPass(results: readonly MethodResult[] | undefined): SenderAuthVerdict {
  const verdicts = results?.map((result) => result.verdict) ?? [];
  if (verdicts.length > 0 && verdicts.every((verdict) => verdict === "pass")) return "pass";
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("none")) return "none";
  return "unknown";
}

/** header.from may carry a full address or a bare domain. */
function domainOfHeaderFrom(value: string): string {
  return fromDomainOf(value) ?? value;
}

/**
 * @param headerValues values of all Authentication-Results headers in file order, topmost first
 * @param trustedAuthservId authserv-id of the account's own server; null = none set, no result
 * @param fromDomain domain of the mail's From address
 */
export function parseSenderAuthentication(
  headerValues: readonly string[],
  trustedAuthservId: string | null,
  fromDomain: string | null,
): SenderAuthentication | null {
  const trusted = normalizeTrustedAuthservId(trustedAuthservId);
  const from = fromDomain?.toLowerCase() ?? "";
  if (trusted === null || from === "") return null;
  for (const headerValue of headerValues) {
    const [head = "", ...resultSegments] = splitSegments(stripComments(headerValue));
    const authservId = head.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (authservId !== trusted) continue;
    const { byMethod, headerFroms } = methodResults(resultSegments);
    if (headerFroms.some((value) => domainOfHeaderFrom(value) !== from)) return null;
    const dmarcResults = byMethod.get("dmarc");
    // A dmarc pass only means something for the domain it was evaluated for.
    const dmarcBound = dmarcResults?.every((result) => result.headerFrom !== null) ?? false;
    const dkimDomains = [
      ...new Set(
        (byMethod.get("dkim") ?? []).flatMap((result) => (result.headerD ? [result.headerD] : [])),
      ),
    ].slice(0, MAX_DKIM_DOMAINS);
    // Values come from sender-controlled headers: one that does not fit the stored shape (length)
    // must give "no statement", not a validation failure that would quarantine the mail.
    const parsed = senderAuthenticationSchema.safeParse({
      authservId,
      spf: combineAllPass(byMethod.get("spf")),
      dkim: combineAnyPass(byMethod.get("dkim")),
      dkimDomains,
      dmarc: dmarcBound ? combineAllPass(dmarcResults) : "unknown",
      fromDomain: from,
    });
    return parsed.success ? parsed.data : null;
  }
  return null;
}
