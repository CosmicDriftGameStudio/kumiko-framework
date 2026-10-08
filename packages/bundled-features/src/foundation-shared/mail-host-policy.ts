// Connect-time egress guard for tenant-supplied SMTP/IMAP hosts (shared by
// mail-transport-smtp and inbound-provider-imap): a tenant-controlled host
// must resolve to a public address, never an internal one. Resolution
// happens exactly once and the caller connects to the resolved address
// directly (see kumiko-http's resolvePublicHostname for why that matters),
// so this also covers hosts that were valid when a tenant set them and
// only later re-resolve to a private address.
//
// `allowedPrivateMailHosts` is the operator's own escape hatch for an
// internal relay or a dev/test server (mailpit, greenmail) — deliberately
// an operator env var (KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS, read via
// readAllowedPrivateMailHostsFromEnv), never a tenant-config key, so a
// tenant can never grant themselves the bypass. Both features register the
// shared mailAllowedPrivateHostsEnvSchema below.

import type { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { resolvePublicHostname } from "@cosmicdrift/kumiko-framework/http";
import * as z from "zod";
import { isHostAllowlisted, readHostAllowlistFromEnv } from "./host-allowlist.js";

export const MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR = "KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS";

// One schema instance, registered by every feature that reads the variable:
// composeEnvSchema accepts the same field instance from several features, so
// an app mounting only one of them still gets the variable validated and
// documented.
export const mailAllowedPrivateHostsEnvSchema = z.object({
  [MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR]: z
    .string()
    .optional()
    .describe(
      "Comma-separated operator allowlist of private/internal hosts (e.g. a local mailpit/greenmail dev server) that bypass the public-address check for SMTP and IMAP host config. Shared by mail-transport-smtp and inbound-provider-imap — never a tenant-config value.",
    ),
});

export function readAllowedPrivateMailHostsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  return readHostAllowlistFromEnv(MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR, env);
}

export type MailHostGuardOptions = {
  readonly allowedPrivateMailHosts?: readonly string[];
  readonly lookupFn?: typeof lookup;
};

export type MailConnectTarget = {
  readonly host: string;
  readonly servername?: string;
};

export async function resolveMailConnectTarget(
  host: string,
  options: MailHostGuardOptions = {},
): Promise<MailConnectTarget> {
  if (isHostAllowlisted(host, options.allowedPrivateMailHosts ?? [])) {
    return { host };
  }
  const resolved = await resolvePublicHostname(host, options.lookupFn);
  // An IP-literal host pins to itself — no hostname was ever there for TLS
  // SNI/cert validation to check, so `servername` stays unset (the mail
  // libraries themselves skip SNI for an IP host).
  if (isIP(host) !== 0) {
    return { host: resolved.address };
  }
  return { host: resolved.address, servername: host };
}

// Re-exported so callers can classify a rejection (policy verdict, no
// retry) without importing kumiko-http directly.
export { BlockedHostError, HostResolutionError } from "@cosmicdrift/kumiko-framework/http";
