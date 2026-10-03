// runBootstrap — one-shot, passwordless first-run provisioning for prod:
// creates the listed tenants (seed hook only on creation) and invites the
// listed users; SystemAdmins receive their global role only when they accept
// the invitation. Idempotent: a second run with the same plan sends nothing,
// an invitation that expired unused is re-sent, accepted or cancelled ones
// stay untouched.
//
// Boots like runWorkerApp (same env, crypto and schema gate) but composes the
// auth feature with the app's invite flow, dispatches its writes as the
// system user, and stops again. Convention: `bin/bootstrap.ts` →
// `dist-server/bootstrap.js` (see buildServerBundle).

import {
  type BootstrapPlan,
  type BootstrapReport,
  bootstrapTenants,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { bootWorkerProcess, resolveWorkerEnvSource } from "./boot/worker-boot-core.js";
import { buildComposeAuthOptions } from "./compose-features.js";
import { type RunProdAppAuthOptions, requireEnv } from "./run-prod-app.js";
import { resolveAuthMail } from "./run-prod-app-boot-context.js";
import type { RunWorkerAppOptions } from "./run-worker-app.js";

const PROCESS_NAME = "runBootstrap";

export type RunBootstrapOptions = Omit<
  RunWorkerAppOptions,
  "wireComponents" | "includeBundled" | "jobs" | "eventDispatcher" | "metrics"
> &
  BootstrapPlan & {
    /** The same auth block the app passes to runProdApp (`admin` is ignored).
     *  Needs a mounted invite flow: `auth.invite`, or `auth.mail` with
     *  SMTP_HOST set — invitations are the only way bootstrap grants access. */
    readonly auth: Omit<RunProdAppAuthOptions, "admin">;
  };

function maskEmailForLog(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "***" : `${email[0]}***${email.slice(at)}`;
}

function logBootstrapReport(report: BootstrapReport): void {
  for (const tenant of report.tenants) {
    // biome-ignore lint/suspicious/noConsole: the report IS the deliverable of a one-shot process
    console.log(
      `[${PROCESS_NAME}] tenant ${tenant.id}: ${tenant.outcome}${tenant.seeded ? " (seeded)" : ""}${tenant.configApplied.length > 0 ? ` (config: ${tenant.configApplied.join(", ")})` : ""}`,
    );
  }
  for (const invite of report.invites) {
    const globalRoles = invite.globalRoles.length > 0 ? ` +${invite.globalRoles.join(",")}` : "";
    // biome-ignore lint/suspicious/noConsole: the report IS the deliverable of a one-shot process
    console.log(
      `[${PROCESS_NAME}] invite ${maskEmailForLog(invite.email)} → tenant ${invite.tenantId}${globalRoles}: ${invite.outcome}`,
    );
  }
}

/** Returns the report, or undefined in KUMIKO_DRY_RUN_ENV=boot mode. Without
 *  an injected `envSource` (a real process) it exits the process when done,
 *  so a k8s Job never hangs on a leftover socket. */
export async function runBootstrap(
  options: RunBootstrapOptions,
): Promise<BootstrapReport | undefined> {
  const envSource = await resolveWorkerEnvSource(options, PROCESS_NAME);
  const jwtSecret = requireEnv("JWT_SECRET", envSource, PROCESS_NAME);
  const effectiveAuth = resolveAuthMail(options.auth, jwtSecret, envSource);
  const authOptions = buildComposeAuthOptions(effectiveAuth);
  if (!authOptions?.invite) {
    throw new Error(
      `[${PROCESS_NAME}] no invite flow mounted — set auth.invite, or auth.mail together with the SMTP_HOST env var`,
    );
  }

  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log(`[${PROCESS_NAME}] booting…`);
  const boot = await bootWorkerProcess(options, envSource, {
    processName: PROCESS_NAME,
    authOptions,
    deliverQueuedInline: true,
  });
  if (boot.kind === "dry-run") return undefined;

  let report: BootstrapReport;
  try {
    report = await bootstrapTenants(
      { db: boot.db, redis: boot.redis, dispatcher: boot.entrypoint.dispatcher },
      {
        tenants: options.tenants,
        ...(options.systemAdmins && { systemAdmins: options.systemAdmins }),
        ...(options.seed && { seed: options.seed }),
      },
    );
  } finally {
    await boot.close();
  }

  logBootstrapReport(report);
  // biome-ignore lint/suspicious/noConsole: boot-time progress hint
  console.log(`[${PROCESS_NAME}] done.`);
  if (options.envSource === undefined) {
    process.exit(0);
  }
  return report;
}
