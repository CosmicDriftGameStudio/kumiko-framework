import { CornerUpLeft } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.ts";
import { AttachmentChip } from "./attachment-chip.tsx";
import { MessageBodyView } from "./message-body-view.tsx";
import type { MessageThreadProps, ThreadMessage } from "./message-types.ts";
import { plainTextOfHtml } from "./quoted-text.ts";
import { SENDER_FRAME_CLASS, SenderSheet } from "./surfaces.tsx";

export type {
  MessageAttachment,
  MessageBody,
  MessageReaderProps,
  MessageReaderTab,
  MessageThreadProps,
  ThreadMessage,
} from "./message-types.ts";

const DEFAULT_CLAMP_LINES = 16;

const PREVIEW_SOURCE_CHARS = 300;

// Joined across lines: a mail's first line is usually only the greeting ("Guten Tag,").
// The row truncates with CSS; the slice only keeps long bodies out of the DOM.
function previewOf(message: ThreadMessage): string {
  const text =
    message.body.kind === "text"
      ? message.body.text
      : (message.body.fallbackText ?? plainTextOfHtml(message.body.html));
  return text.slice(0, PREVIEW_SOURCE_CHARS).replace(/\s+/g, " ").trim();
}

function CollapsedRow({
  message,
  onExpand,
}: {
  readonly message: ThreadMessage;
  readonly onExpand: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      data-testid={`message-row-${message.id}`}
      onClick={onExpand}
      className="flex w-full items-center gap-2.5 border-0 border-b border-sender-frame-border bg-transparent py-2.5 text-left text-foreground"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold">
        {message.direction === "outgoing" && (
          <CornerUpLeft
            aria-hidden="true"
            className="size-3.5"
            data-testid="message-outgoing-icon"
          />
        )}
        {message.author}
      </span>
      <span className="min-w-0 grow truncate text-muted-foreground">{previewOf(message)}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{message.timeLabel}</span>
    </button>
  );
}

function OpenMessage({
  message,
  clampLines,
  remoteImages,
  showHeader,
}: {
  readonly message: ThreadMessage;
  readonly clampLines: number;
  readonly remoteImages: "blocked" | "allowed";
  readonly showHeader: boolean;
}): ReactNode {
  const attachments = message.attachments ?? [];
  return (
    <div data-testid={`message-open-${message.id}`} className="flex flex-col gap-3">
      {showHeader && (
        <div data-testid={`message-header-${message.id}`} className="flex items-baseline gap-2">
          <span className="shrink-0 whitespace-nowrap font-semibold">{message.author}</span>
          {message.address !== undefined && (
            <span className="min-w-0 truncate text-[13px] text-muted-foreground">
              {message.address}
            </span>
          )}
          <span className="grow" />
          <span className="shrink-0 whitespace-nowrap text-[13px] text-muted-foreground">
            {message.timeLabel}
          </span>
        </div>
      )}
      <MessageBodyView
        body={message.body}
        title={message.author}
        clampLines={clampLines}
        remoteImages={remoteImages}
      />
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentChip key={attachment.id} {...attachment} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Mail conversation, oldest first: older messages fold to one line, the last one is open on a sheet. */
export function MessageThread({
  messages,
  clampLines = DEFAULT_CLAMP_LINES,
  remoteImages = "blocked",
  showHeaders = true,
  testId = "message-thread",
}: MessageThreadProps): ReactNode {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const lastIndex = messages.length - 1;
  const hasOlder = messages.length > 1;

  return (
    <section
      data-testid={testId}
      className={cn(SENDER_FRAME_CLASS, "flex flex-col px-4 pb-4", hasOlder ? "pt-1" : "pt-4")}
    >
      {messages.map((message, index) => {
        const open = index === lastIndex || expandedIds.has(message.id);
        if (!open) {
          return (
            <CollapsedRow
              key={message.id}
              message={message}
              onExpand={() => setExpandedIds((ids) => new Set(ids).add(message.id))}
            />
          );
        }
        return (
          <div key={message.id} className={index > 0 ? "mt-3" : undefined}>
            <SenderSheet>
              <OpenMessage
                message={message}
                clampLines={clampLines}
                remoteImages={remoteImages}
                showHeader={showHeaders}
              />
            </SenderSheet>
          </div>
        );
      })}
    </section>
  );
}
