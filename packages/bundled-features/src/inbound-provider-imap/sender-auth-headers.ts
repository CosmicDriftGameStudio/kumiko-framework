import {
  fromDomainOf,
  parseSenderAuthentication,
  type SenderAuthentication,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ParsedMail } from "mailparser";

const HEADER_NAME = "authentication-results";

// headerLines keeps every occurrence in file order, topmost first. Unlike `headers`, which merges
// repeated headers, the order is what the trust rule depends on.
function authenticationResultValues(parsed: ParsedMail): string[] {
  return parsed.headerLines
    .filter((header) => header.key === HEADER_NAME)
    .map((header) => header.line.slice(header.line.indexOf(":") + 1));
}

// A From header with addresses of several domains cannot be bound to one DMARC verdict.
function singleFromDomain(parsed: ParsedMail): string | null {
  const domains = new Set(
    (parsed.from?.value ?? []).map((address) => fromDomainOf(address.address ?? "")),
  );
  const [only] = domains;
  return domains.size === 1 && only ? only : null;
}

export function senderAuthenticationOf(
  parsed: ParsedMail,
  trustedAuthservId: string | null,
): SenderAuthentication | null {
  return parseSenderAuthentication(
    authenticationResultValues(parsed),
    trustedAuthservId,
    singleFromDomain(parsed),
  );
}
