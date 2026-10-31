import { FileText, Image, type LucideIcon, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import type { MessageAttachment } from "./message-types.ts";

const CHIP_CLASS =
  "inline-flex h-11 items-center gap-2.5 rounded-md border border-border bg-transparent py-0 pl-1 pr-3 text-left text-foreground no-underline";

export function attachmentIconFor(kind: MessageAttachment["kind"]): LucideIcon {
  return kind === "image" ? Image : kind === "pdf" ? FileText : Paperclip;
}

function AttachmentIcon({ kind }: { readonly kind: MessageAttachment["kind"] }): ReactNode {
  const Icon = attachmentIconFor(kind);
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded bg-sender-frame text-muted-foreground">
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

/** File chip with icon, name and a second line; renders as link, button or plain box depending on href/onOpen. */
export function AttachmentChip({
  name,
  meta,
  kind,
  onOpen,
  href,
  testId,
}: MessageAttachment & { readonly testId?: string }): ReactNode {
  const content = (
    <>
      <AttachmentIcon kind={kind} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium">{name}</span>
        {meta !== undefined && <span className="text-xs text-muted-foreground">{meta}</span>}
      </span>
    </>
  );
  if (href !== undefined) {
    return (
      <a href={href} data-testid={testId} className={CHIP_CLASS} onClick={onOpen}>
        {content}
      </a>
    );
  }
  if (onOpen !== undefined) {
    return (
      <button type="button" data-testid={testId} className={CHIP_CLASS} onClick={onOpen}>
        {content}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={CHIP_CLASS}>
      {content}
    </div>
  );
}
