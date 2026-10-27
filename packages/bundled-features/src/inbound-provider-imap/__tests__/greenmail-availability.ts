import { reachable } from "./greenmail-mailbox.ts";

export type GreenmailEndpoint = { readonly host: string; readonly port: number };

// Locally the suites skip when no greenmail runs. In CI the service is started by the workflow, so a
// missing one means a broken setup, and a silent skip would turn the whole suite into a green no-op.
export async function greenmailAvailable(
  suite: string,
  endpoints: readonly GreenmailEndpoint[],
): Promise<boolean> {
  const unreachable: string[] = [];
  for (const { host, port } of endpoints) {
    if (!(await reachable(host, port))) unreachable.push(`${host}:${port}`);
  }
  if (unreachable.length === 0) return true;
  const where = unreachable.join(", ");
  if (process.env["CI"] === "true") {
    throw new Error(
      `${suite}: greenmail not reachable on ${where} but CI=true. Start the service (kumiko-services greenmail: true) and pass IMAP_LIVE_HOST/IMAP_LIVE_PORT/IMAP_LIVE_TLS_PORT/IMAP_LIVE_SMTP_PORT and IMAP_SEND_HOST/IMAP_SEND_TLS_PORT; SMTPS must answer on host port 465.`,
    );
  }
  console.warn(`${suite}: no greenmail on ${where}, suite skipped (see docs for docker run)`);
  return false;
}
