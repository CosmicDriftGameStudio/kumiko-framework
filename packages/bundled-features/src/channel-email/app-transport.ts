import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { EmailTransport } from "./types.ts";

// The app transport otherwise lives only in the channel closure; publishing it lets other
// features reach the same sender a tenant without its own provider falls back to.
export const EMAIL_APP_TRANSPORT_EXTENSION = "emailAppTransport" as const;
export const EMAIL_APP_TRANSPORT_USAGE = "app" as const;

export type EmailAppTransport = { readonly transport: EmailTransport | null };

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [EMAIL_APP_TRANSPORT_EXTENSION]: EmailAppTransport;
  }
}

function isEmailAppTransport(options: unknown): options is EmailAppTransport {
  return (
    typeof options === "object" &&
    options !== null &&
    "transport" in options &&
    typeof options.transport === "object" &&
    options.transport !== null &&
    "send" in options.transport &&
    typeof options.transport.send === "function"
  );
}

/** The app-wide transport of channel-email, null when the app has none or no channel-email. */
export function findEmailAppTransport(
  registry: Pick<Registry, "getExtensionUsages">,
): EmailTransport | null {
  const usage = registry
    .getExtensionUsages(EMAIL_APP_TRANSPORT_EXTENSION)
    .find((candidate) => candidate.entityName === EMAIL_APP_TRANSPORT_USAGE);
  return usage !== undefined && isEmailAppTransport(usage.options) ? usage.options.transport : null;
}
