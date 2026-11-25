// Adapter errors usually quote the rejected recipient ("550 <ops@example.com> rejected"); the
// address must not outlive the crypto-shredded dispatch payload in logs.
export function redactEmailAddresses(text: string): string {
  return text.replace(/(?<![^\s<>,;"'])[^\s<>,;"']+@[^\s<>,;"']+/g, "[redacted-address]");
}

// Provider URLs carry secrets in the path (Slack hook, Telegram bot token), the query or
// the userinfo. The origin stays so the log still says which host failed. Any scheme
// counts: smtp://user:pass@host carries credentials just like https.
// A word without "://" is consumed whole, so a long run is scanned once, not once per character.
export function redactUrls(text: string): string {
  if (!text.includes("://")) return text;
  return text.replace(
    /([a-z][a-z0-9+.-]*)(?::\/\/([^\s/?#<>"']*)([^\s<>"']*))?/gi,
    (match: string, schemeName: string, authority: string | undefined, rest: string) => {
      if (authority === undefined) return match;
      const scheme = `${schemeName}://`;
      const host = authority.slice(authority.lastIndexOf("@") + 1);
      return rest.length > 0 && rest !== "/" ? `${scheme}${host}/[redacted]` : `${scheme}${host}`;
    },
  );
}

// Telegram-style bot tokens outside a URL ("<digits>:<35 chars>"). Times like 12:30 are too short to match.
export function redactBotTokens(text: string): string {
  return text.replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "[redacted-token]");
}

export function redactErrorText(text: string): string {
  return redactBotTokens(redactEmailAddresses(redactUrls(text)));
}
