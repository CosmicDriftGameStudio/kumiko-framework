// Constants the browser client shares with the server feature; the server constants re-export them.
export const INBOUND_MAIL_FOUNDATION_FEATURE = "inbound-mail-foundation" as const;

/** Default mount path of the OAuth connect route; the web client builds the reconnect link from it. */
export const INBOUND_MAIL_CONNECT_PATH = "/api/inbound-mail/connect";
/** Client action of the OAuth "Reactivate" row action: sends the browser to the OAuth connect route. */
export const INBOUND_MAIL_RECONNECT_OAUTH_ACTION = `${INBOUND_MAIL_FOUNDATION_FEATURE}:reconnect-oauth`;
