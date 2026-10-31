import type { ReactNode } from "react";
import { useTranslation } from "../../index.ts";
import { attachmentIconFor } from "./attachment-chip.tsx";
import type { MessageAttachment } from "./message-types.ts";

const OPEN_LINK_CLASS =
  "shrink-0 border-0 bg-transparent p-0 text-[13px] font-medium text-primary underline underline-offset-2";

/** Full-width attachment row with a thumbnail box, name, second line and an "open original" link or button. */
export function AttachmentCard({
  name,
  meta,
  kind,
  thumbnailUrl,
  onOpen,
  href,
  testId,
}: Omit<MessageAttachment, "id"> & { readonly testId?: string }): ReactNode {
  const t = useTranslation();
  const Icon = attachmentIconFor(kind);
  const openLabel = t("kumiko.widget.attachment-card.openOriginal");
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2"
    >
      <span className="flex h-[52px] w-10 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-border bg-sender-frame text-muted-foreground">
        {thumbnailUrl !== undefined ? (
          <img src={thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <Icon aria-hidden="true" className="size-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{name}</span>
        {meta !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>
        )}
      </span>
      {href !== undefined ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={OPEN_LINK_CLASS}
          onClick={onOpen}
        >
          {openLabel}
        </a>
      ) : (
        onOpen !== undefined && (
          <button type="button" className={OPEN_LINK_CLASS} onClick={onOpen}>
            {openLabel}
          </button>
        )
      )}
    </div>
  );
}
