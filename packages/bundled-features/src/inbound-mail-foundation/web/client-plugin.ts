// Client feature for inbound-mail-foundation. The mail account screens offer "Reactivate" for an OAuth
// mailbox as a clientAction: signing in again is a browser redirect into the same connect route and
// callback that created the mailbox, which a writeHandler cannot do.

import type { ClientActionHandler, ClientActionOutcome } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import {
  INBOUND_MAIL_CONNECT_PATH,
  INBOUND_MAIL_FOUNDATION_FEATURE,
  INBOUND_MAIL_RECONNECT_OAUTH_ACTION,
} from "./constants.ts";

export type InboundMailFoundationClientOptions = {
  /** Mount path of the connect route, when the app moved it (`connectPath` of
   *  createInboundMailConnectRoutes). Default "/api/inbound-mail/connect". */
  readonly connectPath?: string;
  /** Leaves the app for the provider's sign-in page. Default: `location.assign`. */
  readonly navigate?: (url: string) => void;
};

const INVALID_RECONNECT_ROW = "inboundMail.accounts.reconnect.invalidRow";

function textField(payload: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = payload[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The callback trusts only the signed state, which the connect route builds from the session and these
// parameters; scope "user" makes the signed-in caller the owner, so the route re-checks ownership.
export function oauthReconnectUrl(
  connectPath: string,
  row: { readonly provider: string; readonly address: string; readonly ownerUserId?: string },
): string {
  const query = new URLSearchParams({
    provider: row.provider,
    scope: row.ownerUserId === undefined ? "shared" : "user",
    mailbox: row.address,
  });
  return `${connectPath}?${query.toString()}`;
}

function reconnectOauthHandler(
  connectPath: string,
  navigate: (url: string) => void,
): ClientActionHandler {
  return async (payload): Promise<ClientActionOutcome> => {
    const provider = textField(payload, "provider");
    const address = textField(payload, "address");
    if (provider === undefined || address === undefined) {
      return { ok: false, message: INVALID_RECONNECT_ROW };
    }
    const ownerUserId = textField(payload, "ownerUserId");
    navigate(
      oauthReconnectUrl(connectPath, { provider, address, ...(ownerUserId && { ownerUserId }) }),
    );
    return { ok: true };
  };
}

export function inboundMailFoundationClient(
  options: InboundMailFoundationClientOptions = {},
): ClientFeatureDefinition {
  const navigate = options.navigate ?? ((url: string) => globalThis.location.assign(url));
  return {
    name: INBOUND_MAIL_FOUNDATION_FEATURE,
    clientActions: {
      [INBOUND_MAIL_RECONNECT_OAUTH_ACTION]: reconnectOauthHandler(
        options.connectPath ?? INBOUND_MAIL_CONNECT_PATH,
        navigate,
      ),
    },
  };
}
