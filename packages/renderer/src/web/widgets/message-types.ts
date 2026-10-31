import type { ReactNode } from "react";

export type MessageAttachment = {
  readonly id: string;
  readonly name: string;
  /** Second line, e.g. "Foto, 1,2 MB" or "PDF, 4 Seiten". */
  readonly meta?: string;
  /** Icon only. */
  readonly kind?: "image" | "pdf" | "file";
  readonly onOpen?: () => void;
  readonly href?: string;
};

export type MessageBody =
  | { readonly kind: "text"; readonly text: string }
  /** html MUST be server-sanitized (inbound-mail-foundation bodyHtml). Shown in a sandboxed iframe, no scripts. */
  | { readonly kind: "html"; readonly html: string; readonly fallbackText?: string };

export type ThreadMessage = {
  readonly id: string;
  /** "Anna Schneider" or the caller's "Du". */
  readonly author: string;
  readonly address?: string;
  /** Outgoing messages get the reply icon in the collapsed row. */
  readonly direction: "incoming" | "outgoing";
  /** Preformatted by the caller ("Heute 09:41"). */
  readonly timeLabel: string;
  readonly body: MessageBody;
  readonly attachments?: readonly MessageAttachment[];
};

export type MessageThreadProps = {
  /** Oldest first. All but the last start collapsed to one line (author, first line, time); click expands. */
  readonly messages: readonly ThreadMessage[];
  /** Lines before "Mehr anzeigen" on a long text body. Default 16. A folded thread also cuts an html mail to these lines. */
  readonly clampLines?: number;
  /** External images in html bodies. Default "blocked" with a "Bilder anzeigen" bar. */
  readonly remoteImages?: "blocked" | "allowed";
  /** false drops author, address and time above open messages, for hosts whose page head already names them. */
  readonly showHeaders?: boolean;
  /** Phone reading: older messages fold into one "n earlier mails" toggle instead of a row each, and a clamped mail offers "read the whole mail". */
  readonly foldOlderTogether?: boolean;
  readonly testId?: string;
};

export type MessageReaderTab = {
  readonly id: string;
  readonly label: string;
  /** Shown before the label in the tab strip. */
  readonly icon?: ReactNode;
  /** Small muted text after the label, e.g. "4 Seiten". */
  readonly detail?: string;
  readonly render: () => ReactNode;
};

export type MessageReaderProps = {
  readonly thread: MessageThreadProps;
  /** One tab per attachment ("Anhang 1: Vertrag.pdf"); without tabs no tab bar is shown. */
  readonly attachmentTabs?: readonly MessageReaderTab[];
  /** "mail" = the thread; default "mail". */
  readonly activeTabId?: string;
  readonly onTabChange?: (id: string) => void;
  readonly testId?: string;
};
