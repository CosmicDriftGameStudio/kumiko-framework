import { connect } from "node:net";
import { ImapFlow } from "imapflow";

export function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export type ImapsLogin = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
};

export async function withMailbox<T>(
  login: ImapsLogin,
  work: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: login.host,
    port: login.port,
    secure: true,
    auth: { user: login.user, pass: login.password },
    logger: false,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.logout();
  }
}

export type FoundMail = {
  readonly from?: { readonly name?: string; readonly address?: string };
  readonly inReplyTo?: string;
};

export async function findByMessageId(
  client: ImapFlow,
  path: string,
  messageIdHeader: string,
): Promise<FoundMail | undefined> {
  const mailbox = await client.mailboxOpen(path);
  if (mailbox.exists === 0) return undefined;
  // greenmail leaves In-Reply-To out of the IMAP envelope, so it is read from the header itself.
  for await (const mail of client.fetch("1:*", { envelope: true, headers: ["in-reply-to"] })) {
    if (mail.envelope?.messageId === `<${messageIdHeader}>`) {
      const inReplyTo = mail.headers?.toString().match(/^In-Reply-To:\s*(\S+)/im)?.[1];
      return { from: mail.envelope.from?.[0], inReplyTo };
    }
  }
  return undefined;
}

export async function findSourceByMessageId(
  client: ImapFlow,
  path: string,
  messageIdHeader: string,
): Promise<Buffer | undefined> {
  const mailbox = await client.mailboxOpen(path);
  if (mailbox.exists === 0) return undefined;
  for await (const mail of client.fetch("1:*", { envelope: true, source: true })) {
    if (mail.envelope?.messageId === `<${messageIdHeader}>`) return mail.source;
  }
  return undefined;
}
