import { CornerUpLeft } from "lucide-react";
import { type ReactNode, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { AttachmentCard } from "./attachment-card.tsx";
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

// Beyond any real mail, so the body shows whole once the reader asked for it.
const UNCLAMPED_LINES = 10_000;

function TeaserBody({
  teaser,
  clampLines,
  moreLabelKey,
  onReadWhole,
}: {
  readonly teaser: string;
  readonly clampLines: number;
  readonly moreLabelKey: string;
  readonly onReadWhole: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <div className="flex flex-col items-start gap-1">
      <p
        data-testid="message-teaser"
        className="m-0 w-full whitespace-pre-wrap text-[15px] leading-[1.55] max-md:text-[14px] max-md:leading-[22px]"
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: clampLines,
          overflow: "hidden",
        }}
      >
        {teaser}
      </p>
      <Button variant="link" size="sm" onClick={onReadWhole}>
        {t(moreLabelKey)}
      </Button>
    </div>
  );
}

function OpenMessage({
  message,
  clampLines,
  remoteImages,
  showHeader,
  moreLabelKey,
  attachmentsBelow,
}: {
  readonly message: ThreadMessage;
  readonly clampLines: number;
  readonly remoteImages: "blocked" | "allowed";
  readonly showHeader: boolean;
  readonly moreLabelKey: string | undefined;
  readonly attachmentsBelow: boolean;
}): ReactNode {
  const attachments = attachmentsBelow ? [] : (message.attachments ?? []);
  const [wholeMailRequested, setWholeMailRequested] = useState(false);
  const showTeaser =
    moreLabelKey !== undefined &&
    message.teaser !== undefined &&
    message.teaser !== "" &&
    !wholeMailRequested;
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
      {showTeaser ? (
        <TeaserBody
          teaser={message.teaser}
          clampLines={clampLines}
          moreLabelKey={moreLabelKey}
          onReadWhole={() => setWholeMailRequested(true)}
        />
      ) : (
        <MessageBodyView
          body={message.body}
          title={message.author}
          clampLines={wholeMailRequested ? UNCLAMPED_LINES : clampLines}
          remoteImages={remoteImages}
          {...(moreLabelKey !== undefined && !wholeMailRequested && { moreLabelKey })}
        />
      )}
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
  foldOlderTogether = false,
  testId = "message-thread",
}: MessageThreadProps): ReactNode {
  const t = useTranslation();
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [olderShown, setOlderShown] = useState(false);
  const lastIndex = messages.length - 1;
  const hasOlder = messages.length > 1;
  const olderFolded = foldOlderTogether && hasOlder && !olderShown;

  const cardAttachments = foldOlderTogether ? (messages[lastIndex]?.attachments ?? []) : [];

  return (
    <>
      <section
        data-testid={testId}
        className={cn(
          SENDER_FRAME_CLASS,
          "flex flex-col",
          foldOlderTogether ? "px-2.5 pb-2.5" : "px-4 pb-4",
          hasOlder ? "pt-1" : "pt-4",
        )}
      >
        {olderFolded && (
          <button
            type="button"
            data-testid={`${testId}-earlier`}
            onClick={() => setOlderShown(true)}
            className="border-0 bg-transparent py-2.5 text-left text-[13px] text-foreground-secondary"
          >
            {lastIndex === 1
              ? t("kumiko.widget.message-thread.showEarlierOne")
              : t("kumiko.widget.message-thread.showEarlier", { count: lastIndex })}
          </button>
        )}
        {(olderFolded ? messages.slice(lastIndex) : messages).map((message, offset) => {
          const index = olderFolded ? lastIndex : offset;
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
              <SenderSheet compact={foldOlderTogether}>
                <OpenMessage
                  message={message}
                  clampLines={clampLines}
                  remoteImages={remoteImages}
                  showHeader={showHeaders}
                  attachmentsBelow={foldOlderTogether}
                  moreLabelKey={
                    foldOlderTogether ? "kumiko.widget.message-thread.readWholeMail" : undefined
                  }
                />
              </SenderSheet>
            </div>
          );
        })}
      </section>
      {cardAttachments.length > 0 && (
        <div data-testid={`${testId}-attachments`} className="mt-2.5 flex flex-col gap-2.5">
          {cardAttachments.map(({ id, ...attachment }) => (
            <AttachmentCard key={id} {...attachment} />
          ))}
        </div>
      )}
    </>
  );
}
