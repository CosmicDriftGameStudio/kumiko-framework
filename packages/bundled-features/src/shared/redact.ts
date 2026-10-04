// Adapter errors usually quote the rejected recipient ("550 <ops@example.com> rejected"); the
// address must not outlive the crypto-shredded dispatch payload in logs.
export function redactEmailAddresses(text: string): string {
  return text.replace(/[^\s<>,;"']+@[^\s<>,;"']+/g, "[redacted-address]");
}

// Provider URLs carry secrets in the path (Slack hook, Telegram bot token), the query or
// the userinfo. The origin stays so the log still says which host failed.
export function redactUrls(text: string): string {
  return text.replace(
    /(https?:\/\/)([^\s/?#<>"']*)([^\s<>"']*)/gi,
    (_match, scheme: string, authority: string, rest: string) => {
      const host = authority.slice(authority.lastIndexOf("@") + 1);
      return rest.length > 0 && rest !== "/" ? `${scheme}${host}/[redacted]` : `${scheme}${host}`;
    },
  );
}

export function redactErrorText(text: string): string {
  return redactEmailAddresses(redactUrls(text));
}
