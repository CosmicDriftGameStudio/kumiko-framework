import { type ReactNode, useMemo, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { ClampedText } from "./clamped-text.tsx";
import { HtmlMailFrame } from "./html-mail-frame.tsx";
import type { MessageBody } from "./message-types.ts";
import { hasRemoteImages, splitQuotedHtml, splitQuotedText } from "./quoted-text.ts";

function QuoteToggle({
  lines,
  open,
  onToggle,
}: {
  readonly lines: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <Button variant="secondary" size="sm" expanded={open} onClick={onToggle}>
      {open
        ? t("kumiko.widget.message-thread.hideQuoted")
        : t("kumiko.widget.message-thread.showQuoted", { lines })}
    </Button>
  );
}

function TextBody({
  text,
  clampLines,
}: {
  readonly text: string;
  readonly clampLines: number;
}): ReactNode {
  const [quoteOpen, setQuoteOpen] = useState(false);
  const split = useMemo(() => splitQuotedText(text), [text]);
  return (
    <div className="flex flex-col items-start gap-3 text-[15px] leading-[1.55]">
      <ClampedText lines={clampLines}>
        <p className="m-0 whitespace-pre-wrap">{split.main}</p>
      </ClampedText>
      {split.quoted !== null && (
        <>
          <QuoteToggle
            lines={split.quotedLineCount}
            open={quoteOpen}
            onToggle={() => setQuoteOpen((open) => !open)}
          />
          {quoteOpen && (
            <p
              data-testid="message-quoted"
              className="m-0 w-full whitespace-pre-wrap border-l-2 border-border pl-3 text-[13px] text-muted-foreground"
            >
              {split.quoted}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function HtmlBody({
  html,
  title,
  remoteImages,
}: {
  readonly html: string;
  readonly title: string;
  readonly remoteImages: "blocked" | "allowed";
}): ReactNode {
  const t = useTranslation();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(remoteImages === "allowed");
  const split = useMemo(() => splitQuotedHtml(html), [html]);
  const showImageBar = useMemo(
    () => !imagesAllowed && hasRemoteImages(html),
    [html, imagesAllowed],
  );
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="w-full">
        <HtmlMailFrame html={split.main} title={title} allowRemoteImages={imagesAllowed} />
      </div>
      {showImageBar && (
        <p
          role="note"
          data-testid="message-images-bar"
          className="m-0 text-xs text-muted-foreground"
        >
          {t("kumiko.widget.message-thread.imagesBlocked")}{" "}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-primary underline hover:text-primary/80"
            onClick={() => setImagesAllowed(true)}
          >
            {t("kumiko.widget.message-thread.showImages")}
          </button>
        </p>
      )}
      {split.quoted !== null && (
        <>
          <QuoteToggle
            lines={split.quotedLineCount}
            open={quoteOpen}
            onToggle={() => setQuoteOpen((open) => !open)}
          />
          {quoteOpen && (
            <div className="w-full border-l-2 border-border pl-3">
              <HtmlMailFrame html={split.quoted} title={title} allowRemoteImages={imagesAllowed} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function MessageBodyView({
  body,
  title,
  clampLines,
  remoteImages,
}: {
  readonly body: MessageBody;
  readonly title: string;
  readonly clampLines: number;
  readonly remoteImages: "blocked" | "allowed";
}): ReactNode {
  return body.kind === "text" ? (
    <TextBody text={body.text} clampLines={clampLines} />
  ) : (
    <HtmlBody html={body.html} title={title} remoteImages={remoteImages} />
  );
}
