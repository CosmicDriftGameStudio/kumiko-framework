import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

type MailFrameStyle = { readonly fontFamily: string; readonly color: string };

function stripMarkup(value: string): string {
  return value.replace(/[<>]/g, "");
}

export function buildMailSrcDoc(
  html: string,
  options: { readonly allowRemoteImages: boolean; readonly style: MailFrameStyle },
): string {
  const imageSources = options.allowRemoteImages ? "img-src data: https: http:" : "img-src data:";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${imageSources}`;
  const { fontFamily, color } = options.style;
  const hideBlockedImages = options.allowRemoteImages
    ? ""
    : 'img:not([src^="data:"]){display:none}';
  const tableStyle =
    "table{border-collapse:collapse;border:0}td,th{border:0;border-top:1px solid color-mix(in srgb,currentColor 15%,transparent);padding:4px 8px 4px 0;text-align:left;font-variant-numeric:tabular-nums}tr:first-child>td,tr:first-child>th{border-top-color:currentColor}";
  const baseStyle = `html,body{margin:0;background:transparent}body>:first-child,body>:first-child>:first-child{margin-top:0}body{font-family:${stripMarkup(fontFamily)};font-size:15px;line-height:1.55;color:${stripMarkup(color)};overflow-wrap:anywhere}img{max-width:100%;height:auto}${hideBlockedImages}${tableStyle}a{color:inherit}`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<base target="_blank"><style>',
    baseStyle,
    "</style></head><body>",
    html,
    "</body></html>",
  ].join("");
}

function pageStyle(): MailFrameStyle {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return { fontFamily: "sans-serif", color: "inherit" };
  }
  const computed = getComputedStyle(document.body);
  return { fontFamily: computed.fontFamily || "sans-serif", color: computed.color || "inherit" };
}

/** Renders server-sanitized mail HTML in a script-free sandboxed iframe that grows to its content. */
export function HtmlMailFrame({
  html,
  title,
  allowRemoteImages,
  testId,
}: {
  readonly html: string;
  readonly title: string;
  readonly allowRemoteImages: boolean;
  readonly testId?: string;
}): ReactNode {
  const [height, setHeight] = useState<number | undefined>(undefined);
  const observerRef = useRef<ResizeObserver | null>(null);
  const srcDoc = useMemo(
    () => buildMailSrcDoc(html, { allowRemoteImages, style: pageStyle() }),
    [html, allowRemoteImages],
  );

  const measureContent = useCallback((frame: HTMLIFrameElement) => {
    observerRef.current?.disconnect();
    const contentDocument = frame.contentDocument;
    if (contentDocument === null) return;
    const measure = () => setHeight(contentDocument.documentElement.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(contentDocument.body);
    observerRef.current = observer;
  }, []);

  const releaseObserverOnUnmount = useCallback((frame: HTMLIFrameElement | null) => {
    if (frame === null) return undefined;
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <iframe
      ref={releaseObserverOnUnmount}
      title={title}
      data-testid={testId}
      // allow-same-origin only lets the parent measure the content height; without allow-scripts nothing in the frame runs.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      onLoad={(event) => measureContent(event.currentTarget)}
      className="block w-full border-0"
      style={height === undefined ? undefined : { height }}
    />
  );
}
